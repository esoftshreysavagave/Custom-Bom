# Copyright (c) 2026, Abdul Mannan and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, getdate

def execute(filters=None):
	filters = frappe._dict(filters or {})
	if not filters.get("based_on"):
		frappe.throw(_("Based On is required"))

	columns = get_columns(filters.based_on)
	data = get_data(filters)
	chart = get_chart(data, filters)
	report_summary = get_report_summary(data, filters)

	return columns, data, None, chart, report_summary

def get_columns(based_on):
	qty_label = _("Qty")
	value_label = _("Value")
	pct_label = _("Value %")
	cum_label = _("Cumulative Value")
	cum_pct_label = _("Cumulative Value %")

	if based_on == "Stock Value":
		qty_label = _("Stock Qty")
		value_label = _("Stock Value")
	elif based_on == "Stock Quantity":
		qty_label = _("Stock Qty")
		value_label = _("Stock Value")
		pct_label = _("Qty %")
		cum_label = _("Cumulative Qty")
		cum_pct_label = _("Cumulative Qty %")
	elif based_on == "Consumption Value":
		qty_label = _("Consumption Qty")
		value_label = _("Consumption Value")
	elif based_on == "Consumption Quantity":
		qty_label = _("Consumption Qty")
		value_label = _("Consumption Value")
		pct_label = _("Qty %")
		cum_label = _("Cumulative Qty")
		cum_pct_label = _("Cumulative Qty %")
	elif based_on == "Sales Value":
		qty_label = _("Sales Qty")
		value_label = _("Sales Value")
	elif based_on == "Sales Quantity":
		qty_label = _("Sales Qty")
		value_label = _("Sales Value")
		pct_label = _("Qty %")
		cum_label = _("Cumulative Qty")
		cum_pct_label = _("Cumulative Qty %")

	return [
		{
			"label": _("Item Code"),
			"fieldname": "item_code",
			"fieldtype": "Link",
			"options": "Item",
			"width": 140
		},
		{
			"label": _("Item Name"),
			"fieldname": "item_name",
			"fieldtype": "Data",
			"width": 150
		},
		{
			"label": _("Item Group"),
			"fieldname": "item_group",
			"fieldtype": "Link",
			"options": "Item Group",
			"width": 120
		},
		{
			"label": _("Stock UOM"),
			"fieldname": "stock_uom",
			"fieldtype": "Link",
			"options": "UOM",
			"width": 100
		},
		{
			"label": qty_label,
			"fieldname": "qty",
			"fieldtype": "Float",
			"width": 120
		},
		{
			"label": _("Average Rate"),
			"fieldname": "rate",
			"fieldtype": "Currency",
			"options": "Company:company:default_currency",
			"width": 120
		},
		{
			"label": value_label,
			"fieldname": "value",
			"fieldtype": "Currency",
			"options": "Company:company:default_currency",
			"width": 130
		},
		{
			"label": pct_label,
			"fieldname": "value_percent",
			"fieldtype": "Percent",
			"width": 100
		},
		{
			"label": cum_label,
			"fieldname": "cumulative_value",
			"fieldtype": "Float" if "Quantity" in based_on else "Currency",
			"options": None if "Quantity" in based_on else "Company:company:default_currency",
			"width": 140
		},
		{
			"label": cum_pct_label,
			"fieldname": "cumulative_percent",
			"fieldtype": "Percent",
			"width": 120
		},
		{
			"label": _("ABC Class"),
			"fieldname": "abc_class",
			"fieldtype": "Data",
			"width": 100
		}
	]

def get_data(filters):
	raw_data = fetch_raw_data(filters)
	is_qty_based = "Quantity" in filters.based_on

	positive_rows = []
	zero_or_negative_rows = []

	for row in raw_data:
		row = frappe._dict(row)
		row.rate = flt(row.value) / flt(row.qty) if flt(row.qty) > 0 else 0.0

		metric = flt(row.qty) if is_qty_based else flt(row.value)
		if metric > 0:
			row.metric = metric
			positive_rows.append(row)
		else:
			row.metric = 0.0
			row.value_percent = 0.0
			row.cumulative_value = 0.0
			row.cumulative_percent = 0.0
			row.abc_class = "C"
			zero_or_negative_rows.append(row)

	positive_rows.sort(key=lambda x: x.metric, reverse=True)
	total_metric = sum(row.metric for row in positive_rows)

	class_a_limit = flt(filters.get("class_a_limit", 80.0))
	class_b_limit = flt(filters.get("class_b_limit", 15.0))

	cumulative_metric = 0.0
	prev_cumulative_percent = 0.0

	for row in positive_rows:
		cumulative_metric += row.metric
		row.cumulative_value = cumulative_metric

		row.value_percent = (row.metric / total_metric * 100) if total_metric > 0 else 0.0
		row.cumulative_percent = (cumulative_metric / total_metric * 100) if total_metric > 0 else 0.0

		if prev_cumulative_percent < class_a_limit:
			row.abc_class = "A"
		elif prev_cumulative_percent < (class_a_limit + class_b_limit):
			row.abc_class = "B"
		else:
			row.abc_class = "C"

		prev_cumulative_percent = row.cumulative_percent

	for row in zero_or_negative_rows:
		row.cumulative_value = total_metric
		row.cumulative_percent = 100.0

	return positive_rows + zero_or_negative_rows

def fetch_raw_data(filters):
	based_on = filters.based_on
	company = filters.get("company")

	company_cond = "AND company = %(company)s" if company else ""
	sle_company_cond = "AND sle.company = %(company)s" if company else ""
	si_company_cond = "AND si.company = %(company)s" if company else ""

	item_conditions = ["disabled = 0", "is_stock_item = 1"]
	item_params = {}

	if filters.get("item_group"):
		from frappe.utils.nestedset import get_descendants_of
		groups = get_descendants_of("Item Group", filters.item_group, ignore_permissions=True) + [filters.item_group]
		item_conditions.append("item_group IN %(item_groups)s")
		item_params["item_groups"] = groups

	if filters.get("brand"):
		item_conditions.append("brand = %(brand)s")
		item_params["brand"] = filters.brand

	item_cond_str = " AND ".join(item_conditions)
	items_query = f"""
		SELECT name as item_code, item_name, item_group, stock_uom
		FROM `tabItem`
		WHERE {item_cond_str}
	"""
	items = frappe.db.sql(items_query, item_params, as_dict=True)
	if not items:
		return []

	item_codes = [d.item_code for d in items]
	item_map = {d.item_code: d for d in items}
	for item_code in item_map:
		item_map[item_code].qty = 0.0
		item_map[item_code].value = 0.0

	query_params = {
		"company": company,
		"to_date": filters.to_date,
		"item_codes": item_codes
	}

	if filters.get("from_date"):
		query_params["from_date"] = filters.from_date

	if "Stock" in based_on:
		sub_conditions = []
		conditions = ["sle.item_code IN %(item_codes)s"]
		if filters.get("warehouse"):
			from frappe.utils.nestedset import get_descendants_of
			warehouses = get_descendants_of("Warehouse", filters.warehouse, ignore_permissions=True) + [filters.warehouse]
			sub_conditions.append("warehouse IN %(warehouses)s")
			conditions.append("sle.warehouse IN %(warehouses)s")
			query_params["warehouses"] = warehouses

		sub_cond_str = " AND " + " AND ".join(sub_conditions) if sub_conditions else ""
		cond_str = " AND " + " AND ".join(conditions)

		query = f"""
			SELECT
				sle.item_code,
				SUM(sle.qty_after_transaction) as qty,
				SUM(sle.stock_value) as value
			FROM
				`tabStock Ledger Entry` sle
			INNER JOIN
				(
					SELECT
						item_code,
						warehouse,
						MAX(posting_datetime) as max_datetime,
						MAX(creation) as max_creation
					FROM
						`tabStock Ledger Entry`
					WHERE
						docstatus < 2
						AND is_cancelled = 0
						{company_cond}
						AND posting_date <= %(to_date)s
						{sub_cond_str}
					GROUP BY
						item_code, warehouse
				) max_sle ON sle.item_code = max_sle.item_code
					AND sle.warehouse = max_sle.warehouse
					AND sle.posting_datetime = max_sle.max_datetime
					AND sle.creation = max_sle.max_creation
			WHERE
				sle.docstatus < 2
				AND sle.is_cancelled = 0
				{sle_company_cond}
				{cond_str}
			GROUP BY
				sle.item_code
		"""
		results = frappe.db.sql(query, query_params, as_dict=True)
		for r in results:
			if r.item_code in item_map:
				item_map[r.item_code].qty = flt(r.qty)
				item_map[r.item_code].value = flt(r.value)

	elif "Consumption" in based_on:
		conditions = ["sle.item_code IN %(item_codes)s"]
		if filters.get("warehouse"):
			from frappe.utils.nestedset import get_descendants_of
			warehouses = get_descendants_of("Warehouse", filters.warehouse, ignore_permissions=True) + [filters.warehouse]
			conditions.append("sle.warehouse IN %(warehouses)s")
			query_params["warehouses"] = warehouses

		cond_str = " AND " + " AND ".join(conditions)

		query = f"""
			SELECT
				sle.item_code,
				SUM(ABS(sle.actual_qty)) as qty,
				SUM(ABS(sle.stock_value_difference)) as value
			FROM
				`tabStock Ledger Entry` sle
			WHERE
				sle.docstatus < 2
				AND sle.is_cancelled = 0
				{sle_company_cond}
				AND sle.actual_qty < 0
				AND sle.posting_date BETWEEN %(from_date)s AND %(to_date)s
				{cond_str}
			GROUP BY
				sle.item_code
		"""
		results = frappe.db.sql(query, query_params, as_dict=True)
		for r in results:
			if r.item_code in item_map:
				item_map[r.item_code].qty = flt(r.qty)
				item_map[r.item_code].value = flt(r.value)

	elif "Sales" in based_on:
		conditions = ["sii.item_code IN %(item_codes)s"]
		if filters.get("warehouse"):
			from frappe.utils.nestedset import get_descendants_of
			warehouses = get_descendants_of("Warehouse", filters.warehouse, ignore_permissions=True) + [filters.warehouse]
			conditions.append("sii.warehouse IN %(warehouses)s")
			query_params["warehouses"] = warehouses

		cond_str = " AND " + " AND ".join(conditions)

		query = f"""
			SELECT
				sii.item_code,
				SUM(sii.qty) as qty,
				SUM(sii.base_net_amount) as value
			FROM
				`tabSales Invoice Item` sii
			INNER JOIN
				`tabSales Invoice` si ON sii.parent = si.name
			WHERE
				si.docstatus = 1
				{si_company_cond}
				AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
				{cond_str}
			GROUP BY
				sii.item_code
		"""
		results = frappe.db.sql(query, query_params, as_dict=True)
		for r in results:
			if r.item_code in item_map:
				item_map[r.item_code].qty = flt(r.qty)
				item_map[r.item_code].value = flt(r.value)

	return list(item_map.values())

def get_chart(data, filters):
	is_qty_based = "Quantity" in filters.based_on

	total_a = 0.0
	total_b = 0.0
	total_c = 0.0

	for row in data:
		val = flt(row.qty) if is_qty_based else flt(row.value)
		if row.abc_class == "A":
			total_a += val
		elif row.abc_class == "B":
			total_b += val
		elif row.abc_class == "C":
			total_c += val

	metric_label = _("Quantity") if is_qty_based else _("Value")

	chart = {
		"data": {
			"labels": [_("Class A"), _("Class B"), _("Class C")],
			"datasets": [
				{
					"name": metric_label,
					"values": [round(total_a, 2), round(total_b, 2), round(total_c, 2)]
				}
			]
		},
		"type": "donut",
		"colors": ["#4caf50", "#ff9800", "#f44336"]
	}
	return chart

def get_report_summary(data, filters):
	is_qty_based = "Quantity" in filters.based_on
	company = filters.company

	company_currency = frappe.get_cached_value("Company", company, "default_currency") if company else frappe.db.get_single_value("Global Defaults", "default_currency")

	total_items = len(data)
	class_a_count = sum(1 for row in data if row.abc_class == "A")
	class_b_count = sum(1 for row in data if row.abc_class == "B")
	class_c_count = sum(1 for row in data if row.abc_class == "C")

	total_metric = sum((flt(row.qty) if is_qty_based else flt(row.value)) for row in data)

	pct_a = (class_a_count / total_items * 100) if total_items > 0 else 0.0
	pct_b = (class_b_count / total_items * 100) if total_items > 0 else 0.0
	pct_c = (class_c_count / total_items * 100) if total_items > 0 else 0.0

	summary = [
		{
			"value": total_metric,
			"indicator": "Blue",
			"label": _("Total Quantity") if is_qty_based else _("Total Value"),
			"datatype": "Float" if is_qty_based else "Currency",
			"currency": None if is_qty_based else company_currency
		},
		{
			"value": class_a_count,
			"indicator": "Green",
			"label": _("Class A Items ({0:.1f}%)").format(pct_a),
			"datatype": "Int"
		},
		{
			"value": class_b_count,
			"indicator": "Orange",
			"label": _("Class B Items ({0:.1f}%)").format(pct_b),
			"datatype": "Int"
		},
		{
			"value": class_c_count,
			"indicator": "Red",
			"label": _("Class C Items ({0:.1f}%)").format(pct_c),
			"datatype": "Int"
		}
	]
	return summary
