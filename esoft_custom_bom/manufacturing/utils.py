# Copyright (c) 2026, esoft_custom_bom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt


def get_upstream_work_orders(downstream_wo, item_code):
	"""
	Determine all upstream Work Orders that produce `item_code` for the specific
	logical manufacturing chain of `downstream_wo` within the same Production Plan.
	"""
	if isinstance(downstream_wo, str):
		downstream_wo = frappe.get_doc("Work Order", downstream_wo)

	if not downstream_wo.production_plan:
		return []

	# 1. Identify downstream item and target finished goods chain (production_plan_item)
	target_ppi = None
	if downstream_wo.production_plan_sub_assembly_item:
		sa_info = frappe.db.get_value(
			"Production Plan Sub Assembly Item",
			downstream_wo.production_plan_sub_assembly_item,
			["name", "production_item", "parent_item_code", "production_plan_item", "bom_level"],
			as_dict=True,
		)
		if sa_info:
			downstream_item = sa_info.production_item
			target_ppi = sa_info.production_plan_item
		else:
			downstream_item = downstream_wo.production_item
	else:
		downstream_item = downstream_wo.production_item
		target_ppi = downstream_wo.production_plan_item

	# 2. Find candidate subassembly requirement rows in this Production Plan
	candidate_rows = frappe.get_all(
		"Production Plan Sub Assembly Item",
		filters={
			"parent": downstream_wo.production_plan,
			"production_item": item_code,
		},
		fields=["name", "production_item", "parent_item_code", "production_plan_item", "qty"],
		order_by="idx asc",
	)

	if not candidate_rows:
		return []

	# 3. Match candidate rows belonging to downstream_wo's chain
	if len(candidate_rows) == 1:
		# Single subassembly requirement in the Production Plan (or combined subassembly)
		matching_sa_rows = candidate_rows
	else:
		# Filter by parent_item_code matching downstream_item
		matching_sa_rows = [r for r in candidate_rows if r.parent_item_code == downstream_item]
		if target_ppi:
			ppi_matches = [r for r in matching_sa_rows if r.production_plan_item == target_ppi]
			if ppi_matches:
				matching_sa_rows = ppi_matches

		if not matching_sa_rows:
			# Candidate rows exist for this item in the Production Plan, but for unrelated parent items
			return []

		# Check for genuine ambiguity (multiple conflicting rows with distinct chains)
		unique_ppis = {r.production_plan_item for r in matching_sa_rows if r.production_plan_item}
		if len(unique_ppis) > 1 and not target_ppi:
			frappe.throw(
				_(
					"Cannot determine upstream Work Order for item {0} in Production Plan {1}: "
					"multiple subassembly chains exist and downstream Work Order {2} is not linked to a specific plan item."
				).format(
					frappe.bold(item_code),
					frappe.bold(downstream_wo.production_plan),
					frappe.bold(downstream_wo.name),
				),
				title=_("Ambiguous Production Chain"),
			)

	matching_sa_names = [r.name for r in matching_sa_rows]

	# 4. Query upstream Work Orders matching these subassembly rows
	upstream_wos = frappe.get_all(
		"Work Order",
		filters={
			"production_plan": downstream_wo.production_plan,
			"production_item": item_code,
			"docstatus": 1,
			"status": ("not in", ["Closed", "Stopped"]),
			"name": ("!=", downstream_wo.name),
			"production_plan_sub_assembly_item": ("in", matching_sa_names),
		},
		fields=["name", "produced_qty", "qty", "status", "production_plan_sub_assembly_item"],
		order_by="creation asc",
	)

	if not upstream_wos:
		# Fallback for Work Orders created without production_plan_sub_assembly_item populated
		general_wos = frappe.get_all(
			"Work Order",
			filters={
				"production_plan": downstream_wo.production_plan,
				"production_item": item_code,
				"docstatus": 1,
				"status": ("not in", ["Closed", "Stopped"]),
				"name": ("!=", downstream_wo.name),
			},
			fields=["name", "produced_qty", "qty", "status", "production_plan_sub_assembly_item"],
			order_by="creation asc",
		)
		if general_wos:
			# If all general_wos have explicit links to other non-matching rows, they belong elsewhere
			linked_elsewhere = [
				w for w in general_wos
				if w.production_plan_sub_assembly_item and w.production_plan_sub_assembly_item not in matching_sa_names
			]
			if len(linked_elsewhere) == len(general_wos):
				return []

			unlinked = [w for w in general_wos if not w.production_plan_sub_assembly_item]
			if unlinked and len(candidate_rows) == 1:
				upstream_wos = unlinked
			elif unlinked and len(candidate_rows) > 1:
				frappe.throw(
					_(
						"Cannot determine upstream Work Order for item {0} in Production Plan {1}: "
						"multiple chains exist and matching Work Orders lack subassembly links."
					).format(
						frappe.bold(item_code),
						frappe.bold(downstream_wo.production_plan),
					),
					title=_("Ambiguous Production Chain"),
				)

	return upstream_wos


def get_upstream_work_order(downstream_wo, item_code):
	"""
	Backward-compatible wrapper returning the first matching upstream Work Order.
	"""
	wos = get_upstream_work_orders(downstream_wo, item_code)
	return wos[0] if wos else None


def get_downstream_work_order_names(downstream_wo):
	"""
	Determine all Work Orders belonging to the same logical downstream chain
	that consume material within the Production Plan.
	"""
	if isinstance(downstream_wo, str):
		downstream_wo = frappe.get_doc("Work Order", downstream_wo)

	if not downstream_wo.production_plan:
		return [downstream_wo.name]

	if downstream_wo.production_plan_sub_assembly_item:
		downstream_wos = frappe.get_all(
			"Work Order",
			filters={
				"production_plan": downstream_wo.production_plan,
				"production_plan_sub_assembly_item": downstream_wo.production_plan_sub_assembly_item,
				"docstatus": ("in", [0, 1]),
				"status": ("not in", ["Closed", "Stopped"]),
			},
			pluck="name",
		)
		return downstream_wos if downstream_wos else [downstream_wo.name]

	if downstream_wo.production_plan_item:
		downstream_wos = frappe.get_all(
			"Work Order",
			filters={
				"production_plan": downstream_wo.production_plan,
				"production_plan_item": downstream_wo.production_plan_item,
				"production_item": downstream_wo.production_item,
				"docstatus": ("in", [0, 1]),
				"status": ("not in", ["Closed", "Stopped"]),
			},
			pluck="name",
		)
		return downstream_wos if downstream_wos else [downstream_wo.name]

	return [downstream_wo.name]


def get_available_upstream_qty(downstream_wo, item_code, for_update=False):
	"""
	Calculate how much additional quantity of `item_code` produced by upstream Work Order(s)
	is available to be transferred to `downstream_wo`.

	When for_update=True:
	Acquires row-level exclusive locks (FOR UPDATE) in sorted order on all involved Work Orders
	and reads the latest committed quantities directly from the database to serialize concurrent transfers.
	"""
	if isinstance(downstream_wo, str):
		downstream_wo = frappe.get_doc("Work Order", downstream_wo)

	upstream_wos = get_upstream_work_orders(downstream_wo, item_code)
	if not upstream_wos:
		return None

	upstream_wo_names = [w.name for w in upstream_wos]
	downstream_wo_names = get_downstream_work_order_names(downstream_wo)

	if for_update:
		# Deterministic lock ordering: sort names to prevent deadlocks
		all_wos_to_lock = sorted(set(upstream_wo_names + downstream_wo_names))
		for wo_name in all_wos_to_lock:
			frappe.db.sql("SELECT name FROM `tabWork Order` WHERE name = %s FOR UPDATE", (wo_name,))

		# Locking read for upstream produced_qty
		prod_data = frappe.db.sql(
			"SELECT SUM(produced_qty) AS produced_qty FROM `tabWork Order` WHERE name IN %(names)s FOR UPDATE",
			{"names": tuple(upstream_wo_names)},
			as_dict=True,
		)
		upstream_output = flt(prod_data[0].produced_qty) if prod_data else 0.0

		# Locking read for downstream transferred_qty across this logical chain
		trans_data = frappe.db.sql(
			"""SELECT SUM(transferred_qty) AS transferred_qty
			FROM `tabWork Order Item`
			WHERE parent IN %(parents)s AND item_code = %(item_code)s FOR UPDATE""",
			{"parents": tuple(downstream_wo_names), "item_code": item_code},
			as_dict=True,
		)
		already_transferred = flt(trans_data[0].transferred_qty) if trans_data else 0.0
	else:
		upstream_output = sum(flt(w.produced_qty) for w in upstream_wos)
		trans_data = frappe.db.sql(
			"""SELECT SUM(transferred_qty) AS transferred_qty
			FROM `tabWork Order Item`
			WHERE parent IN %(parents)s AND item_code = %(item_code)s""",
			{"parents": tuple(downstream_wo_names), "item_code": item_code},
			as_dict=True,
		)
		already_transferred = flt(trans_data[0].transferred_qty) if trans_data else 0.0

	available_to_transfer = max(0.0, upstream_output - already_transferred)

	return {
		"upstream_wo_name": ", ".join(upstream_wo_names),
		"upstream_wo_names": upstream_wo_names,
		"downstream_wo_names": downstream_wo_names,
		"upstream_output": upstream_output,
		"already_transferred": already_transferred,
		"available_to_transfer": available_to_transfer,
	}
