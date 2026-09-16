# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from erpnext.manufacturing.doctype.job_card.job_card import JobCard


class CustomJobCard(JobCard):
	def set_process_loss(self):
		"""
		In standard ERPNext, set_process_loss auto-calculates:
		process_loss_qty = for_quantity - total_completed_qty
		which treats any incomplete remainder as destroyed/scrapped.
		In our workflow, we preserve explicit process_loss_qty if entered by user,
		but do NOT auto-assign the uncompleted pending balance as process loss.
		"""
		if not self.process_loss_qty:
			self.process_loss_qty = 0.0

	def before_validate(self):
		if self.docstatus == 1:
			self.adjust_for_quantity_for_partial_batch()
		if hasattr(super(), "before_validate"):
			super().before_validate()

	def validate(self):
		super().validate()
		self.validate_transferred_materials_for_work_order()

	def before_submit(self):
		self.adjust_for_quantity_for_partial_batch()
		self.validate_transferred_materials_for_work_order()
		if hasattr(super(), "before_submit"):
			super().before_submit()

	def adjust_for_quantity_for_partial_batch(self):
		"""
		When submitting a Job Card with a partial batch (completed + process loss < for_quantity),
		adjust for_quantity to match the actual executed batch (completed_qty + process_loss_qty).
		This satisfies ERPNext's validate_job_card requirement without auto-scrapping the remainder,
		while leaving the uncompleted remainder pending on the Work Order for subsequent Job Cards.
		"""
		precision = self.precision("total_completed_qty") or 2
		completed = flt(self.total_completed_qty, precision)
		loss = flt(self.process_loss_qty, precision)
		effective_batch = flt(completed + loss, precision)

		if effective_batch > 0 and flt(self.for_quantity, precision) > effective_batch:
			self.for_quantity = effective_batch

	def validate_transferred_materials_for_work_order(self):
		"""
		Ensure that the Job Card's completed quantity does not exceed the quantity of materials
		legitimately transferred to the Work Order (when skip_transfer is 0).
		"""
		if not self.work_order or not self.total_completed_qty:
			return

		wo = frappe.get_doc("Work Order", self.work_order)
		if wo.skip_transfer:
			return

		if not wo.required_items:
			return

		filters = {
			"docstatus": 1,
			"work_order": self.work_order,
			"operation_id": self.operation_id,
			"is_corrective_job_card": 0,
		}
		if self.name:
			filters["name"] = ("!=", self.name)

		data = frappe.get_all(
			"Job Card",
			fields=[{"SUM": "total_completed_qty", "as": "completed_qty"}],
			filters=filters,
		)
		already_completed = flt(data[0].completed_qty) if data and len(data) > 0 else 0.0
		total_operation_completed = already_completed + flt(self.total_completed_qty)

		precision = self.precision("total_completed_qty") or 2

		for item in wo.required_items:
			if not item.required_qty:
				continue

			# If item is assigned to a specific operation, only validate if it matches current operation
			if item.operation and item.operation != self.operation:
				continue

			ratio = flt(item.required_qty) / flt(wo.qty)
			transferred = flt(item.transferred_qty)

			# Max finished goods that can be produced from this transferred item
			max_allowed_fg = transferred / ratio if ratio else 0.0

			if flt(total_operation_completed, precision) > flt(max_allowed_fg, precision):
				frappe.throw(
					_(
						"Cannot complete {0} units for operation {1} of Work Order {2}. "
						"Only {3} units of required item {4} have been transferred for manufacturing "
						"(Max allowed: {5} units, Already completed: {6})."
					).format(
						frappe.bold(self.total_completed_qty),
						frappe.bold(self.operation),
						frappe.bold(self.work_order),
						frappe.bold(transferred),
						frappe.bold(item.item_code),
						frappe.bold(max_allowed_fg),
						frappe.bold(already_completed),
					),
					title=_("Insufficient Transferred Materials"),
				)
