# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt, nowdate, random_string
from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
from esoft_custom_bom.manufacturing.utils import get_available_upstream_qty, get_upstream_work_orders


class TestSequentialWOHardening(IntegrationTestCase):
	def setUp(self):
		self.company = frappe.db.get_single_value("Global Defaults", "default_company") or "Nidhi Cookware"
		self.prefix = "TEST-HDN-" + random_string(5)

		self.wip_warehouse = frappe.db.get_value(
			"Warehouse", {"company": self.company, "warehouse_name": ("like", "%Work In Progress%")}, "name"
		)
		self.fg_warehouse = frappe.db.get_value(
			"Warehouse", {"company": self.company, "warehouse_name": ("like", "%Finished Goods%")}, "name"
		)
		self.stores_warehouse = (
			frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": ("like", "%Stores%")}, "name")
			or self.wip_warehouse
		)

		self.rm_item = self._create_item(self.prefix + "-RM")
		self.sa_item = self._create_item(self.prefix + "-SA")
		self.fg_item = self._create_item(self.prefix + "-FG")

		self.workstation = self._create_workstation(self.prefix + "-WS")
		self.op1 = self._create_operation(self.prefix + "-OP1")
		self.op2 = self._create_operation(self.prefix + "-OP2")

		self.sa_bom = self._create_sa_bom()
		self.fg_bom = self._create_fg_bom()

		# Initial stock of RM in Stores Warehouse
		self._add_stock(self.rm_item, 10000, self.stores_warehouse)

	def _create_item(self, item_code):
		item = frappe.new_doc("Item")
		item.item_code = item_code
		item.item_name = item_code
		item.item_group = "All Item Groups"
		item.stock_uom = "Nos"
		item.is_stock_item = 1
		item.valuation_rate = 100
		item.gst_hsn_code = "999900"
		item.insert(ignore_permissions=True)
		return item.name

	def _create_workstation(self, ws_name):
		ws = frappe.new_doc("Workstation")
		ws.workstation_name = ws_name
		ws.hour_rate = 100
		ws.insert(ignore_permissions=True)
		return ws.name

	def _create_operation(self, op_name):
		if not frappe.db.exists("Operation", op_name):
			op = frappe.new_doc("Operation")
			op.name = op_name
			op.operation = op_name
			op.workstation = self.workstation
			op.insert(ignore_permissions=True)
			return op.name
		return op_name

	def _create_sa_bom(self):
		bom = frappe.new_doc("BOM")
		bom.item = self.sa_item
		bom.quantity = 1
		bom.company = self.company
		bom.with_operations = 1
		bom.append("items", {
			"item_code": self.rm_item,
			"qty": 1,
			"rate": 100,
		})
		bom.append("operations", {
			"operation": self.op1,
			"workstation": self.workstation,
			"time_in_mins": 30,
			"hour_rate": 100,
		})
		bom.insert(ignore_permissions=True)
		bom.submit()
		return bom.name

	def _create_fg_bom(self):
		bom = frappe.new_doc("BOM")
		bom.item = self.fg_item
		bom.quantity = 1
		bom.company = self.company
		bom.with_operations = 1
		bom.append("items", {
			"item_code": self.sa_item,
			"qty": 1,
			"rate": 200,
			"bom_no": self.sa_bom,
		})
		bom.append("operations", {
			"operation": self.op2,
			"workstation": self.workstation,
			"time_in_mins": 45,
			"hour_rate": 100,
		})
		bom.insert(ignore_permissions=True)
		bom.submit()
		return bom.name

	def _add_stock(self, item_code, qty, warehouse):
		diff_account = frappe.get_cached_value("Company", self.company, "stock_adjustment_account")
		se = frappe.new_doc("Stock Entry")
		se.purpose = "Material Receipt"
		se.stock_entry_type = "Material Receipt"
		se.company = self.company
		se.append("items", {
			"item_code": item_code,
			"t_warehouse": warehouse,
			"qty": qty,
			"basic_rate": 100,
			"cost_center": frappe.db.get_value("Company", self.company, "cost_center"),
			"expense_account": diff_account,
		})
		se.insert(ignore_permissions=True)
		se.submit()
		return se

	def _create_production_plan_and_work_orders(self, qty=100):
		pp = frappe.new_doc("Production Plan")
		pp.company = self.company
		pp.posting_date = nowdate()
		pp.sub_assembly_warehouse = self.stores_warehouse
		pp.append("po_items", {
			"item_code": self.fg_item,
			"bom_no": self.fg_bom,
			"planned_qty": qty,
			"planned_start_date": nowdate(),
			"warehouse": self.fg_warehouse,
			"sub_assembly_warehouse": self.stores_warehouse,
		})
		pp.insert(ignore_permissions=True)
		pp.get_sub_assembly_items()
		pp.submit()

		pp.make_work_order()

		wos = frappe.get_all(
			"Work Order",
			filters={"production_plan": pp.name},
			fields=["name", "production_item", "qty", "bom_no"],
			order_by="creation asc",
		)

		wo1 = None
		wo2 = None
		for w in wos:
			doc = frappe.get_doc("Work Order", w.name)
			doc.wip_warehouse = self.wip_warehouse
			doc.fg_warehouse = self.fg_warehouse if doc.production_item == self.fg_item else self.stores_warehouse
			doc.source_warehouse = self.stores_warehouse
			for req in doc.required_items:
				req.source_warehouse = self.stores_warehouse
			doc.skip_transfer = 0
			doc.transfer_material_against = "Work Order"
			doc.save()
			doc.submit()
			if doc.production_item == self.sa_item:
				wo1 = doc
			elif doc.production_item == self.fg_item:
				wo2 = doc

		return pp, wo1, wo2

	def _complete_job_card(self, work_order_name, completed_qty, process_loss=0, operation=None):
		self.time_offset = getattr(self, "time_offset", 0) + 1
		hour = 8 + (self.time_offset * 2)
		day = 16 + (hour // 24)
		hour = hour % 24
		from_time = f"2026-09-{day:02d} {hour:02d}:00:00"
		to_time = f"2026-09-{day:02d} {hour:02d}:45:00"

		filters = {"work_order": work_order_name, "docstatus": 0}
		if operation:
			filters["operation"] = operation

		jc_names = frappe.get_all("Job Card", filters=filters, pluck="name")
		if jc_names:
			jc_name = jc_names[0]
		else:
			wo = frappe.get_doc("Work Order", work_order_name)
			op_row = None
			if operation:
				for op in wo.operations:
					if op.operation == operation:
						op_row = op
						break
			if not op_row and wo.operations:
				op_row = wo.operations[0]

			jc = frappe.new_doc("Job Card")
			jc.work_order = work_order_name
			jc.operation = op_row.operation if op_row else None
			jc.operation_id = op_row.name if op_row else None
			jc.workstation = op_row.workstation if op_row else self.workstation
			jc.for_quantity = completed_qty + process_loss
			jc.company = self.company
			jc.wip_warehouse = wo.wip_warehouse
			jc.insert(ignore_permissions=True)
			jc_name = jc.name

		jc = frappe.get_doc("Job Card", jc_name)
		jc.append("time_logs", {
			"from_time": from_time,
			"to_time": to_time,
			"completed_qty": completed_qty,
		})
		jc.total_completed_qty = completed_qty
		if process_loss:
			jc.process_loss_qty = process_loss
		jc.save()
		jc.submit()
		return jc

	def _manufacture_work_order(self, work_order_name, qty):
		wo = frappe.get_doc("Work Order", work_order_name)
		se_dict = make_stock_entry(wo.name, "Manufacture", qty=qty)
		se = frappe.get_doc(se_dict)
		for cost in se.additional_costs:
			if not cost.expense_account:
				cost.expense_account = frappe.db.get_value("Company", self.company, "stock_adjustment_account")
		se.insert(ignore_permissions=True)
		se.submit()
		return se

	def _transfer_to_work_order(self, work_order_name, item_code, qty):
		wo = frappe.get_doc("Work Order", work_order_name)
		se_dict = make_stock_entry(wo.name, "Material Transfer for Manufacture", qty=qty)
		se = frappe.get_doc(se_dict)
		# Filter items to only the requested item_code and set qty
		filtered_items = []
		for item in se.items:
			if item.item_code == item_code:
				item.qty = qty
				filtered_items.append(item)
		if filtered_items:
			se.items = filtered_items
		else:
			for item in se.items:
				item.qty = qty
		se.insert(ignore_permissions=True)
		se.submit()
		return se

	# -------------------------------------------------------------------------
	# 1. Job Card update after submit
	# -------------------------------------------------------------------------
	def test_01_job_card_update_after_submit_no_double_count(self):
		"""
		Updating a submitted Job Card must not count its completed quantity twice
		during validate_transferred_materials_for_work_order.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(100)

		# Transfer 50 RM to WO1
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)

		# Complete and submit Job Card for 50
		jc = self._complete_job_card(wo1.name, 50)
		self.assertEqual(jc.docstatus, 1)
		self.assertEqual(jc.total_completed_qty, 50)

		# Verify saving the submitted Job Card does not double-count and throw
		# (Simulate updating allowed-on-submit field / resaving)
		jc.append("time_logs", {
			"from_time": "2026-09-16 11:00:00",
			"to_time": "2026-09-16 11:15:00",
			"completed_qty": 0,
		})
		jc.save()
		self.assertEqual(jc.total_completed_qty, 50)

	# -------------------------------------------------------------------------
	# 2. Stock Entry cancellation
	# -------------------------------------------------------------------------
	def test_02_stock_entry_cancellation_reverses_availability(self):
		"""
		WO1 produces 50. WO2 transfers 50.
		Cancelling the transfer must restore availability back to 50 via standard ERPNext reversal.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(100)

		# Produce 50 on WO1
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_work_order(wo1.name, 50)

		# WO2 transfers 50
		transfer_se = self._transfer_to_work_order(wo2.name, self.sa_item, 50)

		# Now availability for WO2 is 0
		avail = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail["available_to_transfer"]), 0.0)

		# Cancel the transfer
		transfer_se.cancel()

		# Standard ERPNext reversal must restore availability back to 50
		wo2.reload()
		avail_after = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail_after["already_transferred"]), 0.0)
		self.assertEqual(flt(avail_after["available_to_transfer"]), 50.0)

		# A new transfer of 50 should now succeed
		se2 = self._transfer_to_work_order(wo2.name, self.sa_item, 50)
		self.assertEqual(se2.docstatus, 1)

	# -------------------------------------------------------------------------
	# 3. Stock Entry amendment
	# -------------------------------------------------------------------------
	def test_03_stock_entry_amendment_no_duplicate_transferred_qty(self):
		"""
		Cancelling a transfer of 50 and amending it with 30 must leave 20 available.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(100)

		# Produce 50 on WO1
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_work_order(wo1.name, 50)

		# Transfer 50
		transfer_se = self._transfer_to_work_order(wo2.name, self.sa_item, 50)
		transfer_se.cancel()

		# Create amended entry for 30
		diff_account = frappe.get_cached_value("Company", self.company, "stock_adjustment_account")
		amended_se = frappe.copy_doc(transfer_se)
		amended_se.amended_from = transfer_se.name
		amended_se.docstatus = 0
		amended_se.items[0].qty = 30
		amended_se.items[0].expense_account = diff_account
		amended_se.insert()
		amended_se.submit()

		# Check availability: produced 50, transferred 30 -> 20 remaining
		wo2.reload()
		avail = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail["already_transferred"]), 30.0)
		self.assertEqual(flt(avail["available_to_transfer"]), 20.0)

		# Over-transfer of 25 must fail
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo2.name, self.sa_item, 25)

		# Transfer of 20 must succeed
		se_final = self._transfer_to_work_order(wo2.name, self.sa_item, 20)
		self.assertEqual(se_final.docstatus, 1)

	# -------------------------------------------------------------------------
	# 4. Standalone Work Order
	# -------------------------------------------------------------------------
	def test_04_standalone_work_order_unrestricted(self):
		"""
		A standalone Work Order without a Production Plan must not have sequential restrictions.
		"""
		wo = frappe.new_doc("Work Order")
		wo.production_item = self.fg_item
		wo.bom_no = self.fg_bom
		wo.qty = 10
		wo.company = self.company
		wo.wip_warehouse = self.wip_warehouse
		wo.fg_warehouse = self.fg_warehouse
		wo.source_warehouse = self.stores_warehouse
		wo.skip_transfer = 0
		wo.get_items_and_operations_from_bom()
		wo.insert(ignore_permissions=True)
		for req in wo.required_items:
			req.source_warehouse = self.stores_warehouse
		wo.save()
		wo.submit()

		# Stock SA item into Stores Warehouse
		self._add_stock(self.sa_item, 100, self.stores_warehouse)

		# Transfer should succeed without checking upstream production
		se = self._transfer_to_work_order(wo.name, self.sa_item, 10)
		self.assertEqual(se.docstatus, 1)

	# -------------------------------------------------------------------------
	# 5. Multi-item / phased operations
	# -------------------------------------------------------------------------
	def test_05_multi_item_phased_operations_material_validation(self):
		"""
		If Operation 1's materials are transferred but Operation 2's materials are pending,
		Operation 1's Job Card must not be blocked.
		"""
		item_op1 = self._create_item(self.prefix + "-MAT-OP1")
		item_op2 = self._create_item(self.prefix + "-MAT-OP2")
		parent_item = self._create_item(self.prefix + "-PARENT-OP")

		self._add_stock(item_op1, 500, self.stores_warehouse)
		self._add_stock(item_op2, 500, self.stores_warehouse)

		# Create BOM with 2 operations and operation-specific materials
		bom = frappe.new_doc("BOM")
		bom.item = parent_item
		bom.quantity = 1
		bom.company = self.company
		bom.with_operations = 1
		bom.append("operations", {
			"operation": self.op1,
			"workstation": self.workstation,
			"time_in_mins": 30,
			"hour_rate": 100,
		})
		bom.append("operations", {
			"operation": self.op2,
			"workstation": self.workstation,
			"time_in_mins": 30,
			"hour_rate": 100,
		})
		bom.append("items", {
			"item_code": item_op1,
			"qty": 1,
			"rate": 100,
			"operation": self.op1,
		})
		bom.append("items", {
			"item_code": item_op2,
			"qty": 1,
			"rate": 100,
			"operation": self.op2,
		})
		bom.insert(ignore_permissions=True)
		bom.submit()

		# Create Work Order
		wo = frappe.new_doc("Work Order")
		wo.production_item = parent_item
		wo.bom_no = bom.name
		wo.qty = 50
		wo.company = self.company
		wo.wip_warehouse = self.wip_warehouse
		wo.fg_warehouse = self.fg_warehouse
		wo.source_warehouse = self.stores_warehouse
		wo.skip_transfer = 0
		wo.get_items_and_operations_from_bom()
		wo.insert(ignore_permissions=True)
		for req in wo.required_items:
			req.source_warehouse = self.stores_warehouse
		wo.save()
		wo.submit()

		# Transfer material ONLY for Operation 1
		self._transfer_to_work_order(wo.name, item_op1, 50)

		# Operation 1 Job Card should succeed (even though item_op2 has 0 transferred)
		jc1 = self._complete_job_card(wo.name, 50, operation=self.op1)
		self.assertEqual(jc1.docstatus, 1)

		# Operation 2 Job Card must FAIL because item_op2 is not yet transferred
		with self.assertRaises(frappe.ValidationError):
			self._complete_job_card(wo.name, 50, operation=self.op2)

		# Now transfer material for Operation 2
		self._transfer_to_work_order(wo.name, item_op2, 50)

		# Operation 2 Job Card now succeeds
		jc2 = self._complete_job_card(wo.name, 50, operation=self.op2)
		self.assertEqual(jc2.docstatus, 1)

	# -------------------------------------------------------------------------
	# 6. Multi-level BOM
	# -------------------------------------------------------------------------
	def test_06_multi_level_bom_intermediate_output_governs(self):
		"""
		In a 3-level chain: WO1 (SA2) -> WO2 (SA1) -> WO3 (FG).
		WO3 must use WO2's output, NOT WO1's output.
		"""
		sa2_item = self._create_item(self.prefix + "-SA2")
		sa1_item = self._create_item(self.prefix + "-SA1")
		top_fg_item = self._create_item(self.prefix + "-TOP-FG")

		# SA2 BOM (consumes RM)
		bom_sa2 = frappe.new_doc("BOM")
		bom_sa2.item = sa2_item
		bom_sa2.quantity = 1
		bom_sa2.company = self.company
		bom_sa2.with_operations = 1
		bom_sa2.append("items", {"item_code": self.rm_item, "qty": 1, "rate": 50})
		bom_sa2.append("operations", {
			"operation": self.op1,
			"workstation": self.workstation,
			"time_in_mins": 30,
			"hour_rate": 100,
		})
		bom_sa2.insert(ignore_permissions=True)
		bom_sa2.submit()

		# SA1 BOM (consumes SA2)
		bom_sa1 = frappe.new_doc("BOM")
		bom_sa1.item = sa1_item
		bom_sa1.quantity = 1
		bom_sa1.company = self.company
		bom_sa1.with_operations = 1
		bom_sa1.append("items", {"item_code": sa2_item, "qty": 1, "rate": 100, "bom_no": bom_sa2.name})
		bom_sa1.append("operations", {
			"operation": self.op2,
			"workstation": self.workstation,
			"time_in_mins": 30,
			"hour_rate": 100,
		})
		bom_sa1.insert(ignore_permissions=True)
		bom_sa1.submit()

		# FG BOM (consumes SA1)
		bom_fg = frappe.new_doc("BOM")
		bom_fg.item = top_fg_item
		bom_fg.quantity = 1
		bom_fg.company = self.company
		bom_fg.append("items", {"item_code": sa1_item, "qty": 1, "rate": 200, "bom_no": bom_sa1.name})
		bom_fg.insert(ignore_permissions=True)
		bom_fg.submit()

		# Production Plan
		pp = frappe.new_doc("Production Plan")
		pp.company = self.company
		pp.posting_date = nowdate()
		pp.sub_assembly_warehouse = self.stores_warehouse
		pp.append("po_items", {
			"item_code": top_fg_item,
			"bom_no": bom_fg.name,
			"planned_qty": 100,
			"planned_start_date": nowdate(),
			"warehouse": self.fg_warehouse,
			"sub_assembly_warehouse": self.stores_warehouse,
		})
		pp.insert(ignore_permissions=True)
		pp.get_sub_assembly_items()
		pp.submit()
		pp.make_work_order()

		wos = frappe.get_all(
			"Work Order",
			filters={"production_plan": pp.name},
			fields=["name", "production_item", "qty"],
		)
		wo_by_item = {}
		for w in wos:
			doc = frappe.get_doc("Work Order", w.name)
			doc.wip_warehouse = self.wip_warehouse
			doc.fg_warehouse = self.fg_warehouse if doc.production_item == top_fg_item else self.stores_warehouse
			doc.source_warehouse = self.stores_warehouse
			for req in doc.required_items:
				req.source_warehouse = self.stores_warehouse
			doc.skip_transfer = 0
			doc.save()
			doc.submit()
			wo_by_item[doc.production_item] = doc

		wo_sa2 = wo_by_item[sa2_item]
		wo_sa1 = wo_by_item[sa1_item]
		wo_fg = wo_by_item[top_fg_item]

		# WO_SA2 produces 50
		self._transfer_to_work_order(wo_sa2.name, self.rm_item, 50)
		self._complete_job_card(wo_sa2.name, 50)
		self._manufacture_work_order(wo_sa2.name, 50)

		# WO_SA1 can transfer 50 of SA2
		avail_sa1 = get_available_upstream_qty(wo_sa1, sa2_item)
		self.assertEqual(flt(avail_sa1["available_to_transfer"]), 50.0)

		# But WO_FG cannot transfer SA1 yet because WO_SA1 has produced 0
		avail_fg = get_available_upstream_qty(wo_fg, sa1_item)
		self.assertEqual(flt(avail_fg["available_to_transfer"]), 0.0)
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo_fg.name, sa1_item, 10)

		# Now WO_SA1 transfers 50 of SA2 and produces 30 of SA1
		self._transfer_to_work_order(wo_sa1.name, sa2_item, 50)
		self._complete_job_card(wo_sa1.name, 30)
		self._manufacture_work_order(wo_sa1.name, 30)

		# Now WO_FG can transfer up to 30 of SA1 (governed by WO_SA1, not WO_SA2)
		avail_fg_now = get_available_upstream_qty(wo_fg, sa1_item)
		self.assertEqual(flt(avail_fg_now["available_to_transfer"]), 30.0)

		se_fg = self._transfer_to_work_order(wo_fg.name, sa1_item, 30)
		self.assertEqual(se_fg.docstatus, 1)

		# Trying to transfer more than 30 fails
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo_fg.name, sa1_item, 5)

	# -------------------------------------------------------------------------
	# 7. Multiple Work Orders for same item (separate logical chains)
	# -------------------------------------------------------------------------
	def test_07_multiple_work_orders_separate_chains_isolated(self):
		"""
		Two finished goods in one Production Plan share the same subassembly.
		Their manufacturing chains must remain strictly isolated.
		"""
		fg_a = self._create_item(self.prefix + "-FGA")
		fg_b = self._create_item(self.prefix + "-FGB")

		bom_a = frappe.new_doc("BOM")
		bom_a.item = fg_a
		bom_a.quantity = 1
		bom_a.company = self.company
		bom_a.append("items", {"item_code": self.sa_item, "qty": 1, "rate": 100, "bom_no": self.sa_bom})
		bom_a.insert(ignore_permissions=True)
		bom_a.submit()

		bom_b = frappe.new_doc("BOM")
		bom_b.item = fg_b
		bom_b.quantity = 1
		bom_b.company = self.company
		bom_b.append("items", {"item_code": self.sa_item, "qty": 1, "rate": 100, "bom_no": self.sa_bom})
		bom_b.insert(ignore_permissions=True)
		bom_b.submit()

		pp = frappe.new_doc("Production Plan")
		pp.company = self.company
		pp.posting_date = nowdate()
		pp.sub_assembly_warehouse = self.stores_warehouse
		pp.combine_sub_items = 0
		pp.append("po_items", {
			"item_code": fg_a,
			"bom_no": bom_a.name,
			"planned_qty": 40,
			"planned_start_date": nowdate(),
			"warehouse": self.fg_warehouse,
			"sub_assembly_warehouse": self.stores_warehouse,
		})
		pp.append("po_items", {
			"item_code": fg_b,
			"bom_no": bom_b.name,
			"planned_qty": 60,
			"planned_start_date": nowdate(),
			"warehouse": self.fg_warehouse,
			"sub_assembly_warehouse": self.stores_warehouse,
		})
		pp.insert(ignore_permissions=True)
		pp.get_sub_assembly_items()
		pp.submit()
		pp.make_work_order()

		wos = frappe.get_all(
			"Work Order",
			filters={"production_plan": pp.name},
			fields=["name", "production_item", "qty", "production_plan_item", "production_plan_sub_assembly_item"],
		)

		wo_fg_a = None
		wo_fg_b = None
		wo_sa_a = None
		wo_sa_b = None

		for w in wos:
			doc = frappe.get_doc("Work Order", w.name)
			doc.wip_warehouse = self.wip_warehouse
			doc.fg_warehouse = self.fg_warehouse if "FG" in doc.production_item else self.stores_warehouse
			doc.source_warehouse = self.stores_warehouse
			for req in doc.required_items:
				req.source_warehouse = self.stores_warehouse
			doc.skip_transfer = 0
			doc.save()
			doc.submit()

			if doc.production_item == fg_a:
				wo_fg_a = doc
			elif doc.production_item == fg_b:
				wo_fg_b = doc
			elif doc.production_item == self.sa_item:
				sa_row = frappe.db.get_value(
					"Production Plan Sub Assembly Item",
					doc.production_plan_sub_assembly_item,
					["parent_item_code"],
					as_dict=True,
				)
				if sa_row.parent_item_code == fg_a:
					wo_sa_a = doc
				elif sa_row.parent_item_code == fg_b:
					wo_sa_b = doc

		self.assertIsNotNone(wo_sa_a)
		self.assertIsNotNone(wo_sa_b)

		# Produce 25 on WO_SA_A (chain A)
		self._transfer_to_work_order(wo_sa_a.name, self.rm_item, 25)
		self._complete_job_card(wo_sa_a.name, 25)
		self._manufacture_work_order(wo_sa_a.name, 25)

		# WO_FG_A sees 25 available
		avail_a = get_available_upstream_qty(wo_fg_a, self.sa_item)
		self.assertEqual(flt(avail_a["available_to_transfer"]), 25.0)

		# WO_FG_B sees 0 available (chain B produced 0)
		avail_b = get_available_upstream_qty(wo_fg_b, self.sa_item)
		self.assertEqual(flt(avail_b["available_to_transfer"]), 0.0)

		# WO_FG_B cannot transfer
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo_fg_b.name, self.sa_item, 10)

		# WO_FG_A transfers 25 successfully
		se_a = self._transfer_to_work_order(wo_fg_a.name, self.sa_item, 25)
		self.assertEqual(se_a.docstatus, 1)

		# Now produce 50 on WO_SA_B (chain B)
		self._transfer_to_work_order(wo_sa_b.name, self.rm_item, 50)
		self._complete_job_card(wo_sa_b.name, 50)
		self._manufacture_work_order(wo_sa_b.name, 50)

		# WO_FG_B can now transfer 50
		avail_b_now = get_available_upstream_qty(wo_fg_b, self.sa_item)
		self.assertEqual(flt(avail_b_now["available_to_transfer"]), 50.0)
		se_b = self._transfer_to_work_order(wo_fg_b.name, self.sa_item, 50)
		self.assertEqual(se_b.docstatus, 1)

	# -------------------------------------------------------------------------
	# 8. Same-chain multiple upstream Work Orders
	# -------------------------------------------------------------------------
	def test_08_same_chain_multiple_upstream_work_orders_aggregate(self):
		"""
		When multiple upstream Work Orders belong to the same subassembly requirement,
		their physically produced outputs aggregate cumulatively.
		"""
		pp, wo1_a, wo2 = self._create_production_plan_and_work_orders(100)

		# Create a second upstream Work Order for the same subassembly row
		wo1_b = frappe.new_doc("Work Order")
		wo1_b.production_item = self.sa_item
		wo1_b.bom_no = self.sa_bom
		wo1_b.qty = 40
		wo1_b.company = self.company
		wo1_b.production_plan = pp.name
		wo1_b.production_plan_sub_assembly_item = wo1_a.production_plan_sub_assembly_item
		wo1_b.wip_warehouse = self.wip_warehouse
		wo1_b.fg_warehouse = self.stores_warehouse
		wo1_b.source_warehouse = self.stores_warehouse
		wo1_b.skip_transfer = 0
		wo1_b.get_items_and_operations_from_bom()
		wo1_b.insert(ignore_permissions=True)
		for req in wo1_b.required_items:
			req.source_warehouse = self.stores_warehouse
		wo1_b.save()
		wo1_b.submit()

		# WO1_A produces 30
		self._transfer_to_work_order(wo1_a.name, self.rm_item, 30)
		self._complete_job_card(wo1_a.name, 30)
		self._manufacture_work_order(wo1_a.name, 30)

		# WO1_B produces 20
		self._transfer_to_work_order(wo1_b.name, self.rm_item, 20)
		self._complete_job_card(wo1_b.name, 20)
		self._manufacture_work_order(wo1_b.name, 20)

		# Total produced across upstream is 30 + 20 = 50
		avail = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail["upstream_output"]), 50.0)
		self.assertEqual(flt(avail["available_to_transfer"]), 50.0)

		# Downstream transfers 50 -> succeeds
		se = self._transfer_to_work_order(wo2.name, self.sa_item, 50)
		self.assertEqual(se.docstatus, 1)

		# Downstream attempts to transfer 1 more -> rejected
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo2.name, self.sa_item, 1)

	# -------------------------------------------------------------------------
	# 9. Incremental transfer
	# -------------------------------------------------------------------------
	def test_09_incremental_transfer_lifecycle(self):
		"""
		Upstream produces 50 -> downstream transfers 50 -> 0 available.
		Upstream later produces another 50 -> downstream transfers 50 -> complete.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(100)

		# First batch of 50
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_work_order(wo1.name, 50)

		self._transfer_to_work_order(wo2.name, self.sa_item, 50)
		avail_mid = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail_mid["available_to_transfer"]), 0.0)

		# Second batch of 50
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_work_order(wo1.name, 50)

		avail_final = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail_final["available_to_transfer"]), 50.0)

		se2 = self._transfer_to_work_order(wo2.name, self.sa_item, 50)
		self.assertEqual(se2.docstatus, 1)

		avail_done = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail_done["available_to_transfer"]), 0.0)

	# -------------------------------------------------------------------------
	# 10. Concurrent transfer safety
	# -------------------------------------------------------------------------
	def test_10_concurrent_transfer_row_locking_safety(self):
		"""
		Verify row-level locking behavior on Work Orders during validate_stock_entry_upstream_qty.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(100)

		# Produce 50 on WO1
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_work_order(wo1.name, 50)

		# Test locking read: get_available_upstream_qty with for_update=True
		avail = get_available_upstream_qty(wo2, self.sa_item, for_update=True)
		self.assertEqual(flt(avail["available_to_transfer"]), 50.0)

		# First transfer of 50
		se1 = self._transfer_to_work_order(wo2.name, self.sa_item, 50)
		self.assertEqual(se1.docstatus, 1)

		# Competing transfer attempted for 50 must read committed state and be rejected
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo2.name, self.sa_item, 50)

	# -------------------------------------------------------------------------
	# 11. Process loss
	# -------------------------------------------------------------------------
	def test_11_process_loss_reduces_usable_output(self):
		"""
		Genuine process loss reduces usable good output and is not pending production.
		Planned = 100, completed = 48, process loss = 2 -> usable output is 48.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(100)

		# Transfer RM for 50
		self._transfer_to_work_order(wo1.name, self.rm_item, 50)

		# Complete Job Card with 48 good and 2 process loss
		jc = self._complete_job_card(wo1.name, 48, process_loss=2)
		self.assertEqual(flt(jc.for_quantity), 50.0)
		self.assertEqual(flt(jc.total_completed_qty), 48.0)
		self.assertEqual(flt(jc.process_loss_qty), 2.0)

		# Manufacture batch of 50 with process loss = 2
		# make_stock_entry for Manufacture against a Work Order with process loss:
		se_dict = make_stock_entry(wo1.name, "Manufacture", qty=50)
		se = frappe.get_doc(se_dict)
		for cost in se.additional_costs:
			if not cost.expense_account:
				cost.expense_account = frappe.db.get_value("Company", self.company, "stock_adjustment_account")
		se.insert(ignore_permissions=True)
		se.submit()

		wo1.reload()
		self.assertEqual(flt(wo1.produced_qty), 48.0)

		# Available to WO2 is 48 (loss of 2 is excluded)
		avail = get_available_upstream_qty(wo2, self.sa_item)
		self.assertEqual(flt(avail["upstream_output"]), 48.0)
		self.assertEqual(flt(avail["available_to_transfer"]), 48.0)

		# Transfer of 49 fails
		with self.assertRaises(frappe.ValidationError):
			self._transfer_to_work_order(wo2.name, self.sa_item, 49)

		# Transfer of 48 succeeds
		se_transfer = self._transfer_to_work_order(wo2.name, self.sa_item, 48)
		self.assertEqual(se_transfer.docstatus, 1)
