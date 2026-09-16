# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt, nowdate, random_string


class TestSequentialWOIntegration(IntegrationTestCase):
	"""
	Phase 3 End-to-End Integration Scenario Test:
	Complete multi-stage lifecycle from Production Plan through partial batching,
	upstream production, downstream transfer gating, incremental production,
	and final completion of both Work Orders.
	"""

	def setUp(self):
		self.company = frappe.db.get_single_value("Global Defaults", "default_company") or "Nidhi Cookware"
		self.prefix = "TEST-INT-" + random_string(5)

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

		# Initial stock of RM in Stores Warehouse
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
		for item in se.items:
			item.qty = qty
		se.insert(ignore_permissions=True)
		se.submit()
		return se

	def test_end_to_end_sequential_wo_partial_flow(self):
		"""
		Complete End-to-End lifecycle verification:
		1. PP planned_qty = 100 creates WO1 (100) and WO2 (100).
		2. WO1 Job Card completed for partial batch of 50.
		   - WO1 remains qty=100, pending_qty=50, status="In Process".
		3. WO1 manufactures 50. WO1 produced_qty = 50.
		4. WO2 attempts transfer of 60 -> rejected (exceeds available 50).
		5. WO2 transfers 50 -> succeeds.
		6. WO2 attempts duplicate transfer of 1 -> rejected (no additional upstream output).
		7. WO2 creates JC for 50, completes 50, manufactures 50 FG.
		   - WO2 produced_qty = 50, status = "In Process".
		8. WO1 creates JC2 for remaining 50, completes 50, manufactures 50.
		   - WO1 produced_qty = 100, status = "Completed".
		9. WO2 now transfers additional 50 -> succeeds.
		10. WO2 creates JC2 for remaining 50, completes 50, manufactures 50 FG.
		   - WO2 produced_qty = 100, status = "Completed".
		"""
		# Step 1: Create Production Plan and Work Orders
		pp, wo1, wo2 = self._create_production_plan_and_work_orders(qty=100)
		self.assertEqual(wo1.qty, 100)
		self.assertEqual(wo2.qty, 100)

		# Step 2: WO1 transfers RM for 50, completes Job Card 1 for 50
		self._transfer_for_manufacture(wo1.name, 50)
		jc1 = self._complete_job_card(wo1.name, completed_qty=50)
		self.assertEqual(jc1.for_quantity, 50)
		self.assertEqual(flt(jc1.process_loss_qty), 0)

		wo1.reload()
		self.assertEqual(wo1.qty, 100)
		self.assertEqual(wo1.status, "In Process")
		self.assertEqual(wo1.operations[0].completed_qty, 50)
		self.assertEqual(wo1.operations[0].status, "Work in Progress")

		# Step 3: WO1 manufactures 50 SA
		self._manufacture_wo(wo1.name, 50)
		wo1.reload()
		self.assertEqual(wo1.produced_qty, 50)

		# Step 4: WO2 attempts transfer of 60 -> must fail
		# (even if stores warehouse has excess SA)
		self._add_stock(self.sa_item, 500, self.stores_warehouse)

		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry
		se_dict = make_stock_entry(wo2.name, "Material Transfer for Manufacture", qty=60)
		se_over = frappe.get_doc(se_dict)
		for item in se_over.items:
			item.qty = 60
		self.assertRaises(frappe.ValidationError, se_over.insert, ignore_permissions=True)

		# Step 5: WO2 transfers 50 -> succeeds
		se_50 = self._transfer_for_manufacture(wo2.name, 50)
		self.assertEqual(se_50.docstatus, 1)

		wo2.reload()
		transferred_wo2 = [d.transferred_qty for d in wo2.required_items if d.item_code == self.sa_item][0]
		self.assertEqual(transferred_wo2, 50)

		# Step 6: WO2 attempts duplicate transfer of 1 -> rejected
		se_dict_dup = make_stock_entry(wo2.name, "Material Transfer for Manufacture", qty=1)
		se_dup = frappe.get_doc(se_dict_dup)
		for item in se_dup.items:
			item.qty = 1
		self.assertRaises(frappe.ValidationError, se_dup.insert, ignore_permissions=True)

		# Step 7: WO2 creates JC for 50, completes 50, manufactures 50 FG
		from erpnext.manufacturing.doctype.work_order.work_order import make_job_card
		wo2.reload()
		make_job_card(
			work_order=wo2.name,
			operations=[{
				"name": wo2.operations[0].name,
				"operation": wo2.operations[0].operation,
				"workstation": wo2.operations[0].workstation,
				"qty": 50,
				"pending_qty": 50,
				"batch_size": 0,
				"sequence_id": wo2.operations[0].sequence_id,
			}],
			parent_bom=wo2.bom_no,
		)
		self._complete_job_card(wo2.name, 50)
		self._manufacture_wo(wo2.name, 50)
		wo2.reload()
		self.assertEqual(wo2.produced_qty, 50)
		self.assertEqual(wo2.status, "In Process")

		# Step 8: WO1 produces remaining 50
		self._transfer_for_manufacture(wo1.name, 50)
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
		self.assertEqual(wo1.status, "Completed")

		# Step 9: WO2 can now transfer the remaining 50
		se_rem = self._transfer_for_manufacture(wo2.name, 50)
		self.assertEqual(se_rem.docstatus, 1)
		wo2.reload()
		transferred_total = [d.transferred_qty for d in wo2.required_items if d.item_code == self.sa_item][0]
		self.assertEqual(transferred_total, 100)

		# Step 10: WO2 completes remaining 50 and completes the Work Order
		wo2.reload()
		make_job_card(
			work_order=wo2.name,
			operations=[{
				"name": wo2.operations[0].name,
				"operation": wo2.operations[0].operation,
				"workstation": wo2.operations[0].workstation,
				"qty": 50,
				"pending_qty": 50,
				"batch_size": 0,
				"sequence_id": wo2.operations[0].sequence_id,
			}],
			parent_bom=wo2.bom_no,
		)
		self._complete_job_card(wo2.name, 50)
		self._manufacture_wo(wo2.name, 50)

		wo2.reload()
		self.assertEqual(wo2.produced_qty, 100)
		self.assertEqual(wo2.status, "Completed")
