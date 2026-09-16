# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt


def get_upstream_work_order(downstream_wo, item_code):
	"""
	Determine the upstream Work Order that produces `item_code` for the same Production Plan.
	"""
	if isinstance(downstream_wo, str):
		downstream_wo = frappe.get_doc("Work Order", downstream_wo)

	if not downstream_wo.production_plan:
		return None

	upstream_wos = frappe.get_all(
		"Work Order",
		filters={
			"production_plan": downstream_wo.production_plan,
			"production_item": item_code,
			"docstatus": 1,
			"name": ("!=", downstream_wo.name),
		},
		fields=["name", "produced_qty", "qty", "status"],
		order_by="creation asc",
	)

	return upstream_wos[0] if upstream_wos else None


def get_available_upstream_qty(downstream_wo, item_code):
	"""
	Calculate how much additional quantity of `item_code` produced by the upstream Work Order
	is available to be transferred to `downstream_wo`.

	available_to_transfer = max(0, upstream_work_order.produced_qty - downstream_work_order_item.transferred_qty)
	"""
	if isinstance(downstream_wo, str):
		downstream_wo = frappe.get_doc("Work Order", downstream_wo)

	upstream_wo = get_upstream_work_order(downstream_wo, item_code)
	if not upstream_wo:
		return None

	upstream_output = flt(upstream_wo.produced_qty)

	already_transferred = sum(
		flt(d.transferred_qty)
		for d in downstream_wo.required_items
		if d.item_code == item_code
	)

	available_to_transfer = max(0.0, upstream_output - already_transferred)

	return {
		"upstream_wo_name": upstream_wo.name,
		"upstream_output": upstream_output,
		"already_transferred": already_transferred,
		"available_to_transfer": available_to_transfer,
	}
