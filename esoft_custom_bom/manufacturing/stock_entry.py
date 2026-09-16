# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from esoft_custom_bom.manufacturing.utils import get_available_upstream_qty


def validate_stock_entry_upstream_qty(doc, method=None):
	"""
	Hook on Stock Entry validate.
	When performing 'Material Transfer for Manufacture' for a Work Order generated
	from a Production Plan, ensure the transfer quantity does not exceed the quantity
	actually produced and made available by the upstream Work Order.
	"""
	if doc.docstatus >= 2:
		return

	if doc.purpose != "Material Transfer for Manufacture":
		return

	if not doc.work_order:
		return

	wo = frappe.get_doc("Work Order", doc.work_order)
	if not wo.production_plan:
		return

	# Aggregate requested quantities per item_code across stock entry detail rows
	requested_by_item = {}
	for row in doc.items:
		if row.item_code:
			requested_by_item[row.item_code] = requested_by_item.get(row.item_code, 0.0) + flt(row.qty)

	for item_code, requested_qty in requested_by_item.items():
		avail = get_available_upstream_qty(wo, item_code)
		if not avail:
			# Not a subassembly produced by an upstream Work Order in this Production Plan
			continue

		available_to_transfer = flt(avail["available_to_transfer"])
		precision = doc.precision("qty", "items") or 2

		if flt(requested_qty, precision) > flt(available_to_transfer, precision):
			frappe.throw(
				_(
					"Cannot transfer {0} units of {1} for Work Order {2}. "
					"Only {3} units are available from upstream Work Order {4} "
					"(Total produced: {5}, Already transferred: {6})."
				).format(
					frappe.bold(requested_qty),
					frappe.bold(item_code),
					frappe.bold(doc.work_order),
					frappe.bold(available_to_transfer),
					frappe.bold(avail["upstream_wo_name"]),
					frappe.bold(avail["upstream_output"]),
					frappe.bold(avail["already_transferred"]),
				),
				title=_("Upstream Production Unavailable"),
			)
