# Copyright (c) 2026, Abdul Mannan and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, today, flt

@frappe.whitelist()
def get_po_data(company=None, supplier=None, item_code=None, status_filter=None, from_date=None, to_date=None, branch=None):
    conditions = ["po.docstatus = 1", "poi.qty > poi.received_qty"]
    values = {}
    
    if company:
        conditions.append("po.company = %(company)s")
        values["company"] = company
    elif branch and frappe.db.has_column("Purchase Order", "branch"):
        conditions.append("po.branch = %(branch)s")
        values["branch"] = branch

    if supplier:
        conditions.append("po.supplier = %(supplier)s")
        values["supplier"] = supplier
    if item_code:
        conditions.append("poi.item_code = %(item_code)s")
        values["item_code"] = item_code
    if from_date:
        conditions.append("poi.schedule_date >= %(from_date)s")
        values["from_date"] = from_date
    if to_date:
        conditions.append("poi.schedule_date <= %(to_date)s")
        values["to_date"] = to_date
        
    query = f"""
        SELECT 
            po.name as po_no,
            po.transaction_date as po_date,
            poi.schedule_date as required_date,
            po.supplier as supplier,
            po.company as company,
            poi.item_code as item_code,
            poi.item_name as item_name,
            poi.qty as ordered_qty,
            poi.received_qty as received_qty,
            (poi.qty - poi.received_qty) as outstanding_qty,
            poi.rate as rate,
            poi.amount as amount,
            COALESCE((
                SELECT SUM(pii.qty) 
                FROM `tabPurchase Invoice Item` pii 
                INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent 
                WHERE pii.po_detail = poi.name AND pi.docstatus = 1
            ), 0.0) as billed_qty,
            ((poi.qty - poi.received_qty) * poi.rate) as outstanding_amount
        FROM 
            `tabPurchase Order` po
        INNER JOIN 
            `tabPurchase Order Item` poi ON poi.parent = po.name
        WHERE 
            {" AND ".join(conditions)}
        ORDER BY 
            poi.schedule_date ASC
    """
    
    data = frappe.db.sql(query, values, as_dict=True)
    
    current_date = getdate(today())
    
    # Filter and post-process
    filtered_data = []
    total_outstanding_val = 0.0
    total_outstanding_qty = 0.0
    total_pending_bill_val = 0.0
    overdue_count = 0
    open_pos = set()
    
    for row in data:
        # Calculate PO Ageing
        row.ageing_days = (current_date - getdate(row.po_date)).days
        if row.ageing_days < 0:
            row.ageing_days = 0
            
        # Overdue if expected date has passed, OR PO has been open for > 45 days
        row.is_overdue = 1 if (getdate(row.required_date) < current_date or row.ageing_days > 45) else 0
        
        # Calculate pending billed quantity
        row.billed_qty = flt(row.billed_qty)
        row.pending_billed_qty = max(0.0, flt(row.ordered_qty) - row.billed_qty)
        row.pending_bill_val = row.pending_billed_qty * flt(row.rate)
        row.amount = flt(row.amount)
        row.outstanding_amount = flt(row.outstanding_amount)
        row.outstanding_qty = flt(row.outstanding_qty)
        
        # Apply Status Filter (Pending Only: not overdue, Overdue Only: overdue)
        if status_filter == "Pending Only" and row.is_overdue == 1:
            continue
        if status_filter == "Overdue Only" and row.is_overdue == 0:
            continue
            
        filtered_data.append(row)
        total_outstanding_val += flt(row.outstanding_amount)
        total_outstanding_qty += flt(row.outstanding_qty)
        total_pending_bill_val += flt(row.pending_bill_val)
        open_pos.add(row.po_no)
        if row.is_overdue:
            overdue_count += 1
            
    # Get currency symbol/defaults
    currency = None
    if company:
        currency = frappe.get_cached_value("Company", company, "default_currency")
    if not currency:
        currency = frappe.db.get_single_value("Global Defaults", "default_currency") or "INR"
            
    return {
        "items": filtered_data,
        "kpis": {
            "total_open_pos": len(open_pos),
            "total_outstanding_qty": total_outstanding_qty,
            "total_outstanding_val": total_outstanding_val,
            "total_pending_bill_val": total_pending_bill_val,
            "overdue_count": overdue_count
        },
        "currency": currency
    }
