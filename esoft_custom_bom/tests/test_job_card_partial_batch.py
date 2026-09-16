# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt, nowdate, random_string
from erpnext.manufacturing.doctype.work_order.work_order import make_job_card


class TestJobCardPartialBatch(IntegrationTestCase):
	def setUp(self):
		self.company = frappe.db.get_single_value("Global Defaults", "default_company") or "Nidhi Cookware"
		self.prefix = "TEST-JC-PARTIAL-" + random_string(5)
		self.rm_item = self._create_item(self.prefix + "-RM")
		self.fg_item = self._create_item(self.prefix + "-FG")
		self.workstation = self._create_workstation(self.prefix + "-WS")
		self.operation = self._create_operation(self.prefix + "-OP")
		self.bom = self._create_bom()

	def _create_item(self, item_code):
		item = frappe.new_doc("Item")
		item.item_code = item_code
		item.item_name = item_code
		item.item_group = "All Item Groups"
		item.stock_uom = "Nos"
		item.is_stock_item = 1
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

	def _create_bom(self):
		bom = frappe.new_doc("BOM")
		bom.item = self.fg_item
		bom.quantity = 1
		bom.company = self.company
		bom.with_operations = 1
		bom.append("items", {
			"item_code": self.rm_item,
			"qty": 1,
			"rate": 100,
		})
		bom.append("operations", {
			"operation": self.operation,
			"workstation": self.workstation,
			"time_in_mins": 30,
			"hour_rate": 100,
		})
		bom.insert(ignore_permissions=True)
		bom.submit()
		return bom.name

	def _create_work_order(self, qty=100):
		wip_warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": ("like", "%Work In Progress%")}, "name")
		fg_warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": ("like", "%Finished Goods%")}, "name")

		wo = frappe.new_doc("Work Order")
		wo.production_item = self.fg_item
		wo.bom_no = self.bom
		wo.qty = qty
		wo.company = self.company
		wo.wip_warehouse = wip_warehouse
		wo.fg_warehouse = fg_warehouse
		wo.planned_start_date = nowdate()
		wo.skip_transfer = 1
		wo.set_work_order_operations()
		wo.insert(ignore_permissions=True)
		wo.submit()
		return wo

	def test_01_partial_completion_preserves_work_order(self):
		"""
		WO qty = 100.
		First Job Card completes 50 with 0 process loss.
		Assert:
		- Job Card batch quantity (for_quantity) is adjusted to 50
		- process_loss_qty is 0
		- Work Order qty remains 100
		- Work Order operation completed_qty is 50, process_loss_qty is 0
		- Work Order status is 'In Process' and operation status is 'Work in Progress'
		- Remaining pending qty is 50
		- Another Job Card can be created
		"""
		wo = self._create_work_order(qty=100)

		jc_names = frappe.get_all(
			"Job Card",
			filters={"work_order": wo.name, "docstatus": 0},
			pluck="name",
		)
		self.assertEqual(len(jc_names), 1)

		jc = frappe.get_doc("Job Card", jc_names[0])
		self.assertEqual(jc.for_quantity, 100)

		# Add time log for 50 units
		jc.append("time_logs", {
			"from_time": "2026-09-16 10:00:00",
			"to_time": "2026-09-16 12:00:00",
			"completed_qty": 50,
		})
		jc.save()
		jc.submit()
		jc.reload()

		# Job Card assertions
		self.assertEqual(jc.for_quantity, 50)
		self.assertEqual(jc.total_completed_qty, 50)
		self.assertEqual(jc.process_loss_qty, 0)
		self.assertEqual(jc.docstatus, 1)

		# Work Order assertions
		wo.reload()
		self.assertEqual(wo.qty, 100)
		self.assertEqual(wo.status, "In Process")
		self.assertEqual(wo.operations[0].completed_qty, 50)
		self.assertEqual(wo.operations[0].process_loss_qty, 0)
		self.assertEqual(wo.operations[0].status, "Work in Progress")

		# Check that another Job Card can be created
		self.assertTrue(wo.show_create_job_card_button())

	def test_02_remaining_completion_completes_work_order(self):
		"""
		WO qty = 100.
		JC-1 completes 50 -> JC-2 created for remaining 50 and completes 50.
		Assert:
		- Both Job Cards are submitted with for_quantity = 50
		- Work Order completed_qty reaches 100
		- Work Order operation status becomes 'Completed'
		"""
		wo = self._create_work_order(qty=100)

		# Complete JC-1 for 50
		jc1_name = frappe.get_all("Job Card", filters={"work_order": wo.name}, pluck="name")[0]
		jc1 = frappe.get_doc("Job Card", jc1_name)
		jc1.append("time_logs", {
			"from_time": "2026-09-16 10:00:00",
			"to_time": "2026-09-16 12:00:00",
			"completed_qty": 50,
		})
		jc1.save()
		jc1.submit()

		wo.reload()
		# Create second Job Card for remaining 50
		op_row = wo.operations[0]
		make_job_card(
			work_order=wo.name,
			operations=[{
				"name": op_row.name,
				"operation": op_row.operation,
				"workstation": op_row.workstation,
				"qty": 50,
				"pending_qty": 50,
				"batch_size": 0,
				"sequence_id": op_row.sequence_id,
			}],
			parent_bom=wo.bom_no,
		)

		jc_list = frappe.get_all("Job Card", filters={"work_order": wo.name, "docstatus": 0}, pluck="name")
		self.assertEqual(len(jc_list), 1)
		jc2 = frappe.get_doc("Job Card", jc_list[0])
		self.assertEqual(jc2.for_quantity, 50)

		# Complete JC-2 for 50
		jc2.append("time_logs", {
			"from_time": "2026-09-16 13:00:00",
			"to_time": "2026-09-16 15:00:00",
			"completed_qty": 50,
		})
		jc2.save()
		jc2.submit()
		jc2.reload()

		self.assertEqual(jc2.for_quantity, 50)
		self.assertEqual(jc2.total_completed_qty, 50)
		self.assertEqual(jc2.process_loss_qty, 0)

		wo.reload()
		self.assertEqual(wo.operations[0].completed_qty, 100)
		self.assertEqual(wo.operations[0].process_loss_qty, 0)
		self.assertEqual(wo.operations[0].status, "Completed")
		self.assertFalse(wo.show_create_job_card_button())

	def test_03_genuine_process_loss_preserved(self):
		"""
		Job Card targets batch:
		- completed = 48
		- explicit process_loss = 2
		Assert:
		- for_quantity becomes 50
		- total_completed_qty is 48
		- process_loss_qty is 2
		- Work Order operation completed_qty is 48, process_loss_qty is 2
		- Remaining pending qty on Work Order is 50 (100 - 48 - 2)
		"""
		wo = self._create_work_order(qty=100)

		jc_name = frappe.get_all("Job Card", filters={"work_order": wo.name}, pluck="name")[0]
		jc = frappe.get_doc("Job Card", jc_name)
		jc.append("time_logs", {
			"from_time": "2026-09-16 10:00:00",
			"to_time": "2026-09-16 12:00:00",
			"completed_qty": 48,
		})
		jc.process_loss_qty = 2
		jc.save()
		jc.submit()
		jc.reload()

		self.assertEqual(jc.for_quantity, 50)
		self.assertEqual(jc.total_completed_qty, 48)
		self.assertEqual(jc.process_loss_qty, 2)

		wo.reload()
		self.assertEqual(wo.operations[0].completed_qty, 48)
		self.assertEqual(wo.operations[0].process_loss_qty, 2)
		self.assertEqual(wo.operations[0].status, "Work in Progress")
		# 100 - (48 + 2) = 50 pending
		pending = wo.qty - flt(wo.operations[0].completed_qty) - flt(wo.operations[0].process_loss_qty)
		self.assertEqual(pending, 50)
		self.assertTrue(wo.show_create_job_card_button())

	def test_04_full_production_unchanged(self):
		"""
		Standard 100 on 100 full completion behaves normally.
		"""
		wo = self._create_work_order(qty=100)

		jc_name = frappe.get_all("Job Card", filters={"work_order": wo.name}, pluck="name")[0]
		jc = frappe.get_doc("Job Card", jc_name)
		jc.append("time_logs", {
			"from_time": "2026-09-16 10:00:00",
			"to_time": "2026-09-16 15:00:00",
			"completed_qty": 100,
		})
		jc.save()
		jc.submit()
		jc.reload()

		self.assertEqual(jc.for_quantity, 100)
		self.assertEqual(jc.total_completed_qty, 100)
		self.assertEqual(jc.process_loss_qty, 0)

		wo.reload()
		self.assertEqual(wo.operations[0].completed_qty, 100)
		self.assertEqual(wo.operations[0].status, "Completed")
