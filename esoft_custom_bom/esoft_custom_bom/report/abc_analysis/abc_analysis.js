// Copyright (c) 2026, Abdul Mannan and contributors
// For license information, please see license.txt

frappe.query_reports["ABC Analysis"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_default("company"),
			reqd: 1
		},
		{
			fieldname: "based_on",
			label: __("Based On"),
			fieldtype: "Select",
			options: [
				"Stock Value",
				"Stock Quantity",
				"Consumption Value",
				"Consumption Quantity",
				"Sales Value",
				"Sales Quantity"
			],
			default: "Stock Value",
			reqd: 1
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -12),
			depends_on: "eval: ['Consumption Value', 'Consumption Quantity', 'Sales Value', 'Sales Quantity'].includes(doc.based_on)"
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1
		},
		{
			fieldname: "class_a_limit",
			label: __("Class A Limit (%)"),
			fieldtype: "Percent",
			default: 80.0,
			reqd: 1
		},
		{
			fieldname: "class_b_limit",
			label: __("Class B Limit (%)"),
			fieldtype: "Percent",
			default: 15.0,
			reqd: 1
		},
		{
			fieldname: "item_group",
			label: __("Item Group"),
			fieldtype: "Link",
			options: "Item Group"
		},
		{
			fieldname: "brand",
			label: __("Brand"),
			fieldtype: "Link",
			options: "Brand"
		},
		{
			fieldname: "warehouse",
			label: __("Warehouse"),
			fieldtype: "Link",
			options: "Warehouse"
		}
	],
	onload: function(report) {
        // Removed custom update item classification button
	}
};
