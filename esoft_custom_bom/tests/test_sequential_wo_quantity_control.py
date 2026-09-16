# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt, nowdate, nowtime, random_string


class TestSequentialWOQuantityControl(IntegrationTestCase):
	def setUp(self):
		self.company = frappe.db.get_single_value("Global Defaults", "default_company") or "Nidhi Cookware"
		self.prefix = "TEST-SEQ-WO-" + random_string(5)

		self.wip_warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": ("like", "%Work In Progress%")}, "name")
		self.fg_warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": ("like", "%Finished Goods%")}, "name")
		self.stores_warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": ("like", "%Stores%")}, "name") or self.wip_warehouse

		self.rm_item = self._create_item(self.prefix + "-RM")
		self.sa_item = self._create_item(self.prefix + "-SA")
		self.fg_item = self._create_item(self.prefix + "-FG")

		self.workstation = self._create_workstation(self.prefix + "-WS")
		self.op1 = self._create_operation(self.prefix + "-OP1")
		self.op2 = self._create_operation(self.prefix + "-OP2")

		self.sa_bom = self._create_sa_bom()
		self.fg_bom = self._create_fg_bom()

		# Ensure initial stock of RM in Stores Warehouse
		self._add_stock(self.rm_item, 1000, self.stores_warehouse)

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

		# Create Work Orders
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

	def _complete_job_card(self, work_order_name, completed_qty, process_loss=0):
		self.time_offset = getattr(self, "time_offset", 0) + 1
		hour = 8 + (self.time_offset * 2)
		day = 16 + (hour // 24)
		hour = hour % 24
		from_time = f"2026-09-{day:02d} {hour:02d}:00:00"
		to_time = f"2026-09-{day:02d} {hour:02d}:45:00"

		jc_name = frappe.get_all(
			"Job Card",
			filters={"work_order": work_order_name, "docstatus": 0},
			pluck="name",
		)[0]
		jc = frappe.get_doc("Job Card", jc_name)
		jc.append("time_logs", {
			"from_time": from_time,
			"to_time": to_time,
			"completed_qty": completed_qty,
		})
		if process_loss:
			jc.process_loss_qty = process_loss
		jc.save()
		jc.submit()
		return jc

	def _manufacture_wo(self, work_order_name, qty):
		wo = frappe.get_doc("Work Order", work_order_name)
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
		se_dict = make_stock_entry(wo.name, "Manufacture", qty=qty)
		se = frappe.get_doc(se_dict)
		for cost in se.additional_costs:
			if not cost.expense_account:
				cost.expense_account = frappe.db.get_value("Company", self.company, "stock_adjustment_account")
		se.insert(ignore_permissions=True)
		se.submit()
		return se

	def _transfer_for_manufacture(self, work_order_name, qty):
		wo = frappe.get_doc("Work Order", work_order_name)
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
		se_dict = make_stock_entry(wo.name, "Material Transfer for Manufacture", qty=qty)
		se = frappe.get_doc(se_dict)
		# Update items qty to requested test qty
		for item in se.items:
			item.qty = qty
		se.insert(ignore_permissions=True)
		se.submit()
		return se

	def test_A_50_available_transfer_succeeds(self):
		"""
		Test A: WO1 produces 50 units. WO2 requests 50 units.
		Transfer succeeds.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		# WO1 material transfer & production of 50
		self._transfer_for_manufacture(wo1.name, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_wo(wo1.name, 50)

		wo1.reload()
		self.assertEqual(wo1.produced_qty, 50)

		# WO2 transfers 50 -> should succeed
		se = self._transfer_for_manufacture(wo2.name, 50)
		self.assertEqual(se.docstatus, 1)

		wo2.reload()
		transferred = [d.transferred_qty for d in wo2.required_items if d.item_code == self.sa_item][0]
		self.assertEqual(transferred, 50)

	def test_B_over_processing_rejected(self):
		"""
		Test B: WO1 produces 50 units. WO2 requests 60 units.
		Transfer must be rejected with ValidationError.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		self._transfer_for_manufacture(wo1.name, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_wo(wo1.name, 50)

		wo1.reload()
		self.assertEqual(wo1.produced_qty, 50)

		# Add extra stock to warehouse to prove failure is caused by upstream WO constraint, NOT physical stock
		self._add_stock(self.sa_item, 500, self.stores_warehouse)

		# Attempt transfer of 60 for WO2 -> must fail
		wo2 = frappe.get_doc("Work Order", wo2.name)
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
		se_dict = make_stock_entry(wo2.name, "Material Transfer for Manufacture", qty=60)
		se = frappe.get_doc(se_dict)
		for item in se.items:
			item.qty = 60

		self.assertRaises(frappe.ValidationError, se.insert, ignore_permissions=True)

	def test_C_no_duplicate_transfer(self):
		"""
		Test C: WO1 produced = 50, WO2 transferred = 50.
		WO2 requests another 1 unit.
		Must be rejected unless additional upstream production exists.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		self._transfer_for_manufacture(wo1.name, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_wo(wo1.name, 50)

		# First 50 transferred
		self._transfer_for_manufacture(wo2.name, 50)

		# Extra warehouse stock exists
		self._add_stock(self.sa_item, 500, self.stores_warehouse)

		# Attempt transferring 1 more -> must be rejected
		wo2.reload()
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
		se_dict = make_stock_entry(wo2.name, "Material Transfer for Manufacture", qty=1)
		se = frappe.get_doc(se_dict)
		for item in se.items:
			item.qty = 1

		self.assertRaises(frappe.ValidationError, se.insert, ignore_permissions=True)

	def test_D_incremental_production_and_transfer(self):
		"""
		Test D:
		WO1 produced = 50, WO2 transferred = 50.
		WO1 later produces another 50 (total 100).
		WO2 may now transfer the additional 50.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		# First batch of 50
		self._transfer_for_manufacture(wo1.name, 50)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_wo(wo1.name, 50)
		self._transfer_for_manufacture(wo2.name, 50)

		# Second batch of 50 on WO1
		self._transfer_for_manufacture(wo1.name, 50)
		# Create second JC for remaining 50
		from erpnext.manufacturing.doctype.work_order.work_order import make_job_card
		wo1.reload()
		make_job_card(
			work_order=wo1.name,
			operations=[{
				"name": wo1.operations[0].name,
				"operation": wo1.operations[0].operation,
				"workstation": wo1.operations[0].workstation,
				"qty": 50,
				"pending_qty": 50,
				"batch_size": 0,
				"sequence_id": wo1.operations[0].sequence_id,
			}],
			parent_bom=wo1.bom_no,
		)
		self._complete_job_card(wo1.name, 50)
		self._manufacture_wo(wo1.name, 50)

		wo1.reload()
		self.assertEqual(wo1.produced_qty, 100)

		# Now WO2 can transfer the remaining 50
		se2 = self._transfer_for_manufacture(wo2.name, 50)
		self.assertEqual(se2.docstatus, 1)

		wo2.reload()
		transferred = [d.transferred_qty for d in wo2.required_items if d.item_code == self.sa_item][0]
		self.assertEqual(transferred, 100)

	def test_E_full_completion(self):
		"""
		Test E: Full 100 batch completion across both Work Orders.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		self._transfer_for_manufacture(wo1.name, 100)
		self._complete_job_card(wo1.name, 100)
		self._manufacture_wo(wo1.name, 100)

		wo1.reload()
		self.assertEqual(wo1.produced_qty, 100)
		self.assertEqual(wo1.status, "Completed")

		self._transfer_for_manufacture(wo2.name, 100)
		self._complete_job_card(wo2.name, 100)
		self._manufacture_wo(wo2.name, 100)

		wo2.reload()
		self.assertEqual(wo2.produced_qty, 100)
		self.assertEqual(wo2.status, "Completed")

	def test_F_multiple_job_cards_same_operation(self):
		"""
		Test F: Same operation with JC1 = 20, JC2 = 30 -> completed_qty = 50.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		self._transfer_for_manufacture(wo1.name, 50)

		# JC1 completes 20
		jc1_name = frappe.get_all("Job Card", filters={"work_order": wo1.name, "docstatus": 0}, pluck="name")[0]
		jc1 = frappe.get_doc("Job Card", jc1_name)
		jc1.append("time_logs", {"from_time": "2026-09-16 10:00:00", "to_time": "2026-09-16 11:00:00", "completed_qty": 20})
		jc1.save()
		jc1.submit()

		# JC2 completes 30
		from erpnext.manufacturing.doctype.work_order.work_order import make_job_card
		wo1.reload()
		make_job_card(
			work_order=wo1.name,
			operations=[{
				"name": wo1.operations[0].name,
				"operation": wo1.operations[0].operation,
				"workstation": wo1.operations[0].workstation,
				"qty": 30,
				"pending_qty": 80,
				"batch_size": 0,
				"sequence_id": wo1.operations[0].sequence_id,
			}],
			parent_bom=wo1.bom_no,
		)
		jc2_name = frappe.get_all("Job Card", filters={"work_order": wo1.name, "docstatus": 0}, pluck="name")[0]
		jc2 = frappe.get_doc("Job Card", jc2_name)
		jc2.append("time_logs", {"from_time": "2026-09-16 11:30:00", "to_time": "2026-09-16 13:00:00", "completed_qty": 30})
		jc2.save()
		jc2.submit()

		wo1.reload()
		self.assertEqual(wo1.operations[0].completed_qty, 50)

	def test_G_multiple_operations_final_op_governs_output(self):
		"""
		Test G: Multiple operations in WO1:
		Op 1 = 100, Op 2 = 50 (final). Usable output = 50.
		"""
		# Create 2-operation BOM for SA
		op_a = self._create_operation(self.prefix + "-OPA")
		op_b = self._create_operation(self.prefix + "-OPB")

		sa_2op_item = self._create_item(self.prefix + "-SA2")
		bom = frappe.new_doc("BOM")
		bom.item = sa_2op_item
		bom.quantity = 1
		bom.company = self.company
		bom.with_operations = 1
		bom.append("items", {"item_code": self.rm_item, "qty": 1, "rate": 100})
		bom.append("operations", {"operation": op_a, "workstation": self.workstation, "time_in_mins": 20, "hour_rate": 100})
		bom.append("operations", {"operation": op_b, "workstation": self.workstation, "time_in_mins": 30, "hour_rate": 100})
		bom.insert(ignore_permissions=True)
		bom.submit()

		wo = frappe.new_doc("Work Order")
		wo.production_item = sa_2op_item
		wo.bom_no = bom.name
		wo.qty = 100
		wo.company = self.company
		wo.wip_warehouse = self.wip_warehouse
		wo.fg_warehouse = self.wip_warehouse
		wo.source_warehouse = self.stores_warehouse
		wo.skip_transfer = 1
		wo.set_work_order_operations()
		wo.insert(ignore_permissions=True)
		wo.submit()

		# Op 1 completes 100
		jc1_name = frappe.get_all("Job Card", filters={"work_order": wo.name, "sequence_id": 1}, pluck="name")[0]
		jc1 = frappe.get_doc("Job Card", jc1_name)
		jc1.append("time_logs", {"from_time": "2026-09-16 10:00:00", "to_time": "2026-09-16 12:00:00", "completed_qty": 100})
		jc1.save()
		jc1.submit()

		# Op 2 completes 50
		jc2_name = frappe.get_all("Job Card", filters={"work_order": wo.name, "sequence_id": 2}, pluck="name")[0]
		jc2 = frappe.get_doc("Job Card", jc2_name)
		jc2.append("time_logs", {"from_time": "2026-09-16 12:30:00", "to_time": "2026-09-16 14:00:00", "completed_qty": 50})
		jc2.save()
		jc2.submit()

		wo.reload()
		self.assertEqual(wo.operations[0].completed_qty, 100)
		self.assertEqual(wo.operations[1].completed_qty, 50)

		# Manufacture can only produce 50 (governed by final op)
		se = self._manufacture_wo(wo.name, 50)
		self.assertEqual(se.docstatus, 1)
		wo.reload()
		self.assertEqual(wo.produced_qty, 50)

	def test_H_genuine_process_loss_reduces_usable_output(self):
		"""
		Test H: WO1 produces 48 good and 2 process loss.
		Downstream usable output = 48.
		"""
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)

		self._transfer_for_manufacture(wo1.name, 50)
		self._complete_job_card(wo1.name, completed_qty=48, process_loss=2)

		# Manufacture 50 (48 produced + 2 process loss)
		self._manufacture_wo(wo1.name, 50)

		wo1.reload()
		self.assertEqual(wo1.produced_qty, 48)

		# WO2 requests 48 -> succeeds
		se = self._transfer_for_manufacture(wo2.name, 48)
		self.assertEqual(se.docstatus, 1)

		# WO2 requests 1 more -> fails because usable output is only 48
		self._add_stock(self.sa_item, 500, self.stores_warehouse)
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
		se_dict = make_stock_entry(wo2.name, "Material Transfer for Manufacture", qty=1)
		se_fail = frappe.get_doc(se_dict)
		for item in se_fail.items:
			item.qty = 1
		self.assertRaises(frappe.ValidationError, se_fail.insert, ignore_permissions=True)
