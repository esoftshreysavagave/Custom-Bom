# Copyright (c) 2026, Abdul Mannan and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, today, flt, date_diff

@frappe.whitelist()
def get_inventory_data(company=None, warehouse=None, item_group=None, from_date=None, to_date=None, tab=None):
    if not to_date:
        to_date = today()
    if not from_date:
        # Default to first day of current year or 3 months ago to show reasonable history
        from_date = frappe.utils.add_months(to_date, -3)

    # Base conditions for Stock Ledger Entries
    sle_conditions = ["sle.docstatus < 2", "sle.is_cancelled = 0"]
    values = {}

    if company:
        sle_conditions.append("sle.company = %(company)s")
        values["company"] = company
    
    if warehouse:
        # Resolve group warehouse child nodes
        wh_lft, wh_rgt = frappe.db.get_value("Warehouse", warehouse, ["lft", "rgt"])
        if wh_lft and wh_rgt:
            child_whs = frappe.db.get_all("Warehouse", filters={"lft": (">=", wh_lft), "rgt": ("<=", wh_rgt)}, pluck="name")
            if child_whs:
                sle_conditions.append("sle.warehouse IN %(warehouses)s")
                values["warehouses"] = child_whs
        else:
            sle_conditions.append("sle.warehouse = %(warehouse)s")
            values["warehouse"] = warehouse

    if item_group:
        ig_lft, ig_rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
        if ig_lft and ig_rgt:
            child_igs = frappe.db.get_all("Item Group", filters={"lft": (">=", ig_lft), "rgt": ("<=", ig_rgt)}, pluck="name")
            if child_igs:
                sle_conditions.append("item.item_group IN %(item_groups)s")
                values["item_groups"] = child_igs
        else:
            sle_conditions.append("item.item_group = %(item_group)s")
            values["item_group"] = item_group

    # Get currency symbol/defaults
    currency = None
    if company:
        currency = frappe.get_cached_value("Company", company, "default_currency")
    if not currency:
        currency = frappe.db.get_single_value("Global Defaults", "default_currency") or "USD"

    # Tab 3: Shelf Life & Expiry Logic (Queries Batches)
    # In ERPNext v15, batch_no is stored via Serial and Batch Bundle, NOT directly on SLE.
    # We join SLE -> Serial and Batch Bundle -> Serial and Batch Entry -> Batch.
    if tab == "expiry":
        sle_conditions.append("sle.posting_date <= %(to_date)s")
        sle_conditions.append("sle.is_cancelled = 0")
        sle_conditions.append("sle.serial_and_batch_bundle IS NOT NULL")
        values["to_date"] = to_date

        # Build WHERE clause without the sle-only filters (we need item join too)
        where_clause = " AND ".join(sle_conditions)

        query = f"""
            SELECT 
                sle.item_code,
                item.item_name,
                item.item_group,
                sle.warehouse,
                sbl.batch_no,
                batch.expiry_date,
                SUM(sbl.qty) as bal_qty,
                sle.company,
                IFNULL(bin.valuation_rate, 0) as val_rate
            FROM 
                `tabStock Ledger Entry` sle
            INNER JOIN 
                `tabItem` item ON sle.item_code = item.name
            INNER JOIN
                `tabSerial and Batch Bundle` sabb ON sle.serial_and_batch_bundle = sabb.name
            INNER JOIN
                `tabSerial and Batch Entry` sbl ON sbl.parent = sabb.name
            INNER JOIN 
                `tabBatch` batch ON sbl.batch_no = batch.name
            LEFT JOIN
                `tabBin` bin ON sle.item_code = bin.item_code AND sle.warehouse = bin.warehouse
            WHERE 
                {where_clause}
                AND batch.expiry_date IS NOT NULL
                AND item.has_expiry_date = 1
            GROUP BY 
                sle.item_code, 
                sle.warehouse, 
                sbl.batch_no,
                item.item_name, 
                item.item_group, 
                batch.expiry_date, 
                sle.company,
                bin.valuation_rate
            HAVING 
                SUM(sbl.qty) > 0
            ORDER BY 
                batch.expiry_date ASC
        """
        batch_rows = frappe.db.sql(query, values, as_dict=True)
        
        # Calculate valuation and metrics
        items_data = []
        expired_val = 0.0
        near_expiry_val = 0.0
        safe_val = 0.0
        total_batched_qty = 0.0
        
        for row in batch_rows:
            val_rate = flt(row.val_rate)
            row.val_rate = val_rate
            row.bal_val = flt(row.bal_qty) * val_rate
            total_batched_qty += flt(row.bal_qty)
            
            # Expiry status
            if row.expiry_date:
                days_to_expiry = date_diff(row.expiry_date, to_date)
                row.days_to_expiry = days_to_expiry
                if days_to_expiry < 0:
                    row.status = "Expired"
                    expired_val += row.bal_val
                elif days_to_expiry <= 30:
                    row.status = "Expiring < 30 Days"
                    near_expiry_val += row.bal_val
                elif days_to_expiry <= 90:
                    row.status = "Expiring < 90 Days"
                    near_expiry_val += row.bal_val
                else:
                    row.status = "Safe"
                    safe_val += row.bal_val
            else:
                row.days_to_expiry = 9999
                row.status = "Safe"
                safe_val += row.bal_val
                
            items_data.append(row)
            
        return {
            "items": items_data,
            "kpis": {
                "expired_val": expired_val,
                "near_expiry_val": near_expiry_val,
                "safe_val": safe_val,
                "total_qty": total_batched_qty
            },
            "currency": currency
        }

    # Tab 1 & Tab 2 (Valuation / Slow Moving) - Query aggregated data up to to_date
    values["to_date"] = to_date
    values["from_date"] = from_date
    sle_conditions.append("sle.posting_date <= %(to_date)s")
    
    query = f"""
        SELECT 
            sle.item_code,
            sle.warehouse,
            item.item_name,
            item.item_group,
            item.stock_uom,
            sle.company,
            -- Balance qty at to_date
            SUM(sle.actual_qty) as bal_qty,
            -- Sum of In qty and Out qty within the date range
            SUM(CASE WHEN sle.posting_date >= %(from_date)s AND sle.actual_qty > 0 THEN sle.actual_qty ELSE 0 END) as in_qty,
            SUM(CASE WHEN sle.posting_date >= %(from_date)s AND sle.actual_qty < 0 THEN -sle.actual_qty ELSE 0 END) as out_qty,
            -- Sum of In value difference and Out value difference
            SUM(CASE WHEN sle.posting_date >= %(from_date)s AND sle.stock_value_difference > 0 THEN sle.stock_value_difference ELSE 0 END) as in_val,
            SUM(CASE WHEN sle.posting_date >= %(from_date)s AND sle.stock_value_difference < 0 THEN -sle.stock_value_difference ELSE 0 END) as out_val,
            -- Last transaction date
            MAX(sle.posting_date) as last_date,
            -- Valuation rate and reserved quantities from Bin
            IFNULL(bin.valuation_rate, 0) as val_rate
        FROM 
            `tabStock Ledger Entry` sle
        INNER JOIN 
            `tabItem` item ON sle.item_code = item.name
        LEFT JOIN
            `tabBin` bin ON sle.item_code = bin.item_code AND sle.warehouse = bin.warehouse
        WHERE 
            {" AND ".join(sle_conditions)}
        GROUP BY 
            sle.item_code, 
            sle.warehouse, 
            item.item_name, 
            item.item_group, 
            item.stock_uom, 
            sle.company,
            bin.valuation_rate
        HAVING
            SUM(sle.actual_qty) != 0 OR SUM(CASE WHEN sle.posting_date >= %(from_date)s THEN ABS(sle.actual_qty) ELSE 0 END) > 0
    """
    entries = frappe.db.sql(query, values, as_dict=True)
    
    filtered_items = []
    total_val = 0.0
    total_qty = 0.0
    
    # Stock velocity classification metrics
    active_val = 0.0
    active_items_count = 0
    slow_moving_val = 0.0
    slow_items_count = 0
    non_moving_val = 0.0
    non_items_count = 0

    for row in entries:
        # Normalize and calculate values
        row["bal_qty"] = flt(row["bal_qty"], 3)
        row["in_qty"] = flt(row["in_qty"], 3)
        row["out_qty"] = flt(row["out_qty"], 3)
        row["in_val"] = flt(row["in_val"], 2)
        row["out_val"] = flt(row["out_val"], 2)
        row["val_rate"] = flt(row["val_rate"])



        # Stock value is balance qty * valuation rate
        row["bal_val"] = flt(row["bal_qty"] * row["val_rate"], 2)

        # Calculate opening balance mathematically
        row["opening_qty"] = flt(row["bal_qty"] - row["in_qty"] + row["out_qty"], 3)
        row["opening_val"] = flt(row["bal_val"] - row["in_val"] + row["out_val"], 2)
        
        days_inactive = date_diff(to_date, row["last_date"]) if row["last_date"] else 9999
        row["days_inactive"] = days_inactive
        
        # Determine status
        if days_inactive > 90:
            row["status"] = "Non-Moving"
        elif days_inactive > 30:
            row["status"] = "Slow-Moving"
        else:
            row["status"] = "Active"

        filtered_items.append(row)
        
        if row["bal_qty"] > 0:
            total_val += row["bal_val"]
            total_qty += row["bal_qty"]
            
            if row["status"] == "Active":
                active_val += row["bal_val"]
                active_items_count += 1
            elif row["status"] == "Slow-Moving":
                slow_moving_val += row["bal_val"]
                slow_items_count += 1
            elif row["status"] == "Non-Moving":
                non_moving_val += row["bal_val"]
                non_items_count += 1

    if tab == "slow_moving":
        kpis = {
            "active_moving_val": active_val,
            "active_items_count": active_items_count,
            "slow_moving_val": slow_moving_val,
            "slow_items_count": slow_items_count,
            "non_moving_val": non_moving_val,
            "non_items_count": non_items_count
        }
    else:
        kpis = {
            "total_val": total_val,
            "total_qty": total_qty,
            "stocked_items": active_items_count + slow_items_count + non_items_count,
            "zero_stock_items": sum(1 for r in filtered_items if r["bal_qty"] <= 0)
        }

    # Get Last Transaction Date (global/filtered)
    last_date_conditions = ["docstatus < 2", "is_cancelled = 0"]
    last_date_values = {}
    if item_group:
        ig_lft, ig_rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
        if ig_lft and ig_rgt:
            child_igs = frappe.db.get_all("Item Group", filters={"lft": (">=", ig_lft), "rgt": ("<=", ig_rgt)}, pluck="name")
            if child_igs:
                last_date_conditions.append("item_code IN (SELECT name FROM `tabItem` WHERE item_group IN %(child_igs)s)")
                last_date_values["child_igs"] = child_igs
        else:
            last_date_conditions.append("item_code IN (SELECT name FROM `tabItem` WHERE item_group = %(item_group)s)")
            last_date_values["item_group"] = item_group
    if warehouse:
        wh_lft, wh_rgt = frappe.db.get_value("Warehouse", warehouse, ["lft", "rgt"])
        if wh_lft and wh_rgt:
            whs = frappe.db.get_all("Warehouse", filters={"lft": (">=", wh_lft), "rgt": ("<=", wh_rgt)}, pluck="name")
            last_date_conditions.append("warehouse IN %(whs)s")
            last_date_values["whs"] = whs
        else:
            last_date_conditions.append("warehouse = %(warehouse)s")
            last_date_values["warehouse"] = warehouse
    if company:
        last_date_conditions.append("company = %(company)s")
        last_date_values["company"] = company

    last_transaction_date = frappe.db.sql(f"""
        SELECT MAX(posting_date) FROM `tabStock Ledger Entry`
        WHERE {" AND ".join(last_date_conditions)}
    """, last_date_values)[0][0]

    if not last_transaction_date:
        last_transaction_date = today()
    else:
        last_transaction_date = str(last_transaction_date)

    return {
        "items": filtered_items,
        "kpis": kpis,
        "currency": currency,
        "last_transaction_date": last_transaction_date
    }


@frappe.whitelist()
def get_item_analysis_data(company=None, warehouse=None, item_group=None, item_code=None, to_date=None):
    if not to_date:
        to_date = today()

    # 1. Resolve Item Codes list
    item_codes = []
    if item_code:
        item_codes = [item_code]
    elif item_group:
        ig_lft, ig_rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
        if ig_lft and ig_rgt:
            child_igs = frappe.db.get_all("Item Group", filters={"lft": (">=", ig_lft), "rgt": ("<=", ig_rgt)}, pluck="name")
            if child_igs:
                item_codes = frappe.db.get_all("Item", filters={"item_group": ("in", child_igs)}, pluck="name")
        else:
            item_codes = frappe.db.get_all("Item", filters={"item_group": item_group}, pluck="name")
    
    if not item_codes:
        return {
            "kpis": {"total_qty": 0.0, "total_val": 0.0, "reorder_level": 0.0, "lead_time_days": 0.0},
            "ageing": {"0-30": {"qty": 0.0, "val": 0.0}, "30-60": {"qty": 0.0, "val": 0.0}, "60-90": {"qty": 0.0, "val": 0.0}, ">90": {"qty": 0.0, "val": 0.0}},
            "suppliers": [],
            "reorders": [],
            "urgency_reorders": [],
            "currency": frappe.get_cached_value("Company", company, "default_currency") if company else "USD"
        }

    # 2. Resolve Warehouses list
    warehouses = []
    if warehouse:
        wh_lft, wh_rgt = frappe.db.get_value("Warehouse", warehouse, ["lft", "rgt"])
        if wh_lft and wh_rgt:
            warehouses = frappe.db.get_all("Warehouse", filters={"lft": (">=", wh_lft), "rgt": ("<=", wh_rgt)}, pluck="name")
        else:
            warehouses = [warehouse]

    # Get currency symbol/defaults
    currency = None
    if company:
        currency = frappe.get_cached_value("Company", company, "default_currency")
    if not currency:
        currency = frappe.db.get_single_value("Global Defaults", "default_currency") or "USD"

    # 3. Calculate KPI: Total Qty, Total Valuation, Reorder Level, and Lead Time
    sle_conditions = ["sle.docstatus < 2", "sle.is_cancelled = 0", "sle.item_code IN %(item_codes)s", "sle.posting_date <= %(to_date)s"]
    sle_values = {"item_codes": item_codes, "to_date": to_date}
    if warehouses:
        sle_conditions.append("sle.warehouse IN %(warehouses)s")
        sle_values["warehouses"] = warehouses
    if company:
        sle_conditions.append("sle.company = %(company)s")
        sle_values["company"] = company

    sle_query = f"""
        SELECT 
            sle.item_code,
            sle.warehouse,
            SUM(sle.actual_qty) as bal_qty,
            IFNULL(bin.valuation_rate, 0) as val_rate
        FROM 
            `tabStock Ledger Entry` sle
        LEFT JOIN
            `tabBin` bin ON sle.item_code = bin.item_code AND sle.warehouse = bin.warehouse
        WHERE 
            {" AND ".join(sle_conditions)}
        GROUP BY 
            sle.item_code, 
            sle.warehouse,
            bin.valuation_rate
    """
    stock_balances = frappe.db.sql(sle_query, sle_values, as_dict=True)

    # Aggregate current stock
    total_qty = sum(flt(b.bal_qty) for b in stock_balances)
    total_val = sum(flt(b.bal_qty) * flt(b.val_rate) for b in stock_balances)

    # Lead Time from Item master (averaged if multiple items in group)
    lead_time_query = "SELECT AVG(IFNULL(lead_time_days, 0)) FROM `tabItem` WHERE name IN %(item_codes)s"
    lead_time_days = flt(frappe.db.sql(lead_time_query, {"item_codes": item_codes})[0][0])

    # 4. Supplier Lead Time details from Child Table (Item Supplier)
    supplier_query = """
        SELECT 
            parent as item_code,
            supplier,
            0 as lead_time,
            supplier_part_no
        FROM 
            `tabItem Supplier`
        WHERE 
            parent IN %(item_codes)s
        ORDER BY 
            supplier ASC
    """
    suppliers = frappe.db.sql(supplier_query, {"item_codes": item_codes}, as_dict=True)

    # 5. Reorder Levels and Urgency
    reorder_conditions = ["parent IN %(item_codes)s"]
    reorder_values = {"item_codes": item_codes}
    if warehouse:
        if warehouses:
            reorder_conditions.append("warehouse IN %(warehouses)s")
            reorder_values["warehouses"] = warehouses
        else:
            reorder_conditions.append("warehouse = %(warehouse)s")
            reorder_values["warehouse"] = warehouse

    reorder_query = f"""
        SELECT 
            parent as item_code,
            warehouse,
            warehouse_reorder_level as reorder_level,
            warehouse_reorder_qty as reorder_qty,
            material_request_type
        FROM 
            `tabItem Reorder`
        WHERE 
            {" AND ".join(reorder_conditions)}
    """
    reorder_configs = frappe.db.sql(reorder_query, reorder_values, as_dict=True)

    # Map current stock qty per Item-Warehouse
    stock_map = {}
    for b in stock_balances:
        stock_map[(b.item_code, b.warehouse)] = stock_map.get((b.item_code, b.warehouse), 0.0) + flt(b.bal_qty)

    reorders_list = []
    urgency_reorders = []
    total_reorder_level = 0.0

    for r in reorder_configs:
        item_name = frappe.db.get_value("Item", r.item_code, "item_name")
        curr_qty = stock_map.get((r.item_code, r.warehouse), 0.0)
        reorder_level = flt(r.reorder_level)
        reorder_qty = flt(r.reorder_qty)
        total_reorder_level += reorder_level

        is_reached = 1 if curr_qty <= reorder_level else 0
        deficit = max(0.0, reorder_level - curr_qty)
        ratio = (curr_qty / reorder_level) if reorder_level > 0 else (0.0 if curr_qty <= 0 else 999.0)

        row_data = {
            "item_code": r.item_code,
            "item_name": item_name,
            "warehouse": r.warehouse,
            "bal_qty": curr_qty,
            "reorder_level": reorder_level,
            "reorder_qty": reorder_qty,
            "material_request_type": r.material_request_type,
            "deficit": deficit,
            "ratio": ratio,
            "status": "Reorder Required" if is_reached else "Okay"
        }
        reorders_list.append(row_data)
        if is_reached:
            urgency_reorders.append(row_data)

    # Sort urgency reorders by ratio ascending (lowest first, meaning closest to absolute depletion / most urgent)
    urgency_reorders.sort(key=lambda x: x["ratio"])

    # 6. FIFO Stock Ageing Logic
    sle_ageing_conditions = ["sle.docstatus < 2", "sle.is_cancelled = 0", "sle.item_code IN %(item_codes)s", "sle.actual_qty > 0", "sle.posting_date <= %(to_date)s"]
    sle_ageing_values = {"item_codes": item_codes, "to_date": to_date}
    if warehouses:
        sle_ageing_conditions.append("sle.warehouse IN %(warehouses)s")
        sle_ageing_values["warehouses"] = warehouses
    if company:
        sle_ageing_conditions.append("sle.company = %(company)s")
        sle_ageing_values["company"] = company

    ageing_sle_query = f"""
        SELECT 
            sle.item_code,
            sle.warehouse,
            sle.posting_date,
            sle.actual_qty,
            IFNULL(bin.valuation_rate, 0) as val_rate
        FROM 
            `tabStock Ledger Entry` sle
        LEFT JOIN
            `tabBin` bin ON sle.item_code = bin.item_code AND sle.warehouse = bin.warehouse
        WHERE 
            {" AND ".join(sle_ageing_conditions)}
        ORDER BY 
            sle.posting_date DESC,
            sle.posting_time DESC,
            sle.creation DESC
    """
    inbound_entries = frappe.db.sql(ageing_sle_query, sle_ageing_values, as_dict=True)

    item_wh_balances = {}
    for b in stock_balances:
        if b.bal_qty > 0:
            item_wh_balances[(b.item_code, b.warehouse)] = {
                "bal_qty": flt(b.bal_qty),
                "val_rate": flt(b.val_rate)
            }

    inbound_map = {}
    for entry in inbound_entries:
        key = (entry.item_code, entry.warehouse)
        if key not in inbound_map:
            inbound_map[key] = []
        inbound_map[key].append(entry)

    age_buckets = {
        "0-30": {"qty": 0.0, "val": 0.0},
        "30-60": {"qty": 0.0, "val": 0.0},
        "60-90": {"qty": 0.0, "val": 0.0},
        ">90": {"qty": 0.0, "val": 0.0}
    }

    for key, bal in item_wh_balances.items():
        qty_to_age = bal["bal_qty"]
        rate = bal["val_rate"]
        entries = inbound_map.get(key, [])

        for entry in entries:
            if qty_to_age <= 0:
                break
            entry_qty = flt(entry.actual_qty)
            age_days = date_diff(to_date, entry.posting_date)

            qty_consumed = min(qty_to_age, entry_qty)
            qty_to_age -= qty_consumed

            if age_days <= 30:
                bucket = "0-30"
            elif age_days <= 60:
                bucket = "30-60"
            elif age_days <= 90:
                bucket = "60-90"
            else:
                bucket = ">90"

            age_buckets[bucket]["qty"] += qty_consumed
            age_buckets[bucket]["val"] += qty_consumed * rate

        if qty_to_age > 0:
            age_buckets[">90"]["qty"] += qty_to_age
            age_buckets[">90"]["val"] += qty_to_age * rate

    last_date_conditions = ["docstatus < 2", "is_cancelled = 0", "item_code IN %(item_codes)s"]
    last_date_values = {"item_codes": item_codes}
    if warehouses:
        last_date_conditions.append("warehouse IN %(warehouses)s")
        last_date_values["warehouses"] = warehouses
    if company:
        last_date_conditions.append("company = %(company)s")
        last_date_values["company"] = company

    last_transaction_date = frappe.db.sql(f"""
        SELECT MAX(posting_date) FROM `tabStock Ledger Entry`
        WHERE {" AND ".join(last_date_conditions)}
    """, last_date_values)[0][0]

    if not last_transaction_date:
        last_transaction_date = today()
    else:
        last_transaction_date = str(last_transaction_date)

    # 8. Warehouse Distribution List
    warehouse_distribution = []
    for key, bal in item_wh_balances.items():
        item_c, wh = key
        bal_qty = bal["bal_qty"]
        bal_val = bal_qty * bal["val_rate"]
        if bal_qty > 0 or bal_val > 0:
            warehouse_distribution.append({
                "warehouse": wh,
                "qty": bal_qty,
                "val": bal_val
            })
    warehouse_distribution.sort(key=lambda x: x["qty"], reverse=True)

    # 9. Monthly Consumption vs Receipts Trend (Last 6 Months)
    from frappe.utils import add_months
    start_date = add_months(to_date, -5)
    start_date_parsed = getdate(start_date)
    start_date = start_date_parsed.replace(day=1)

    trend_conditions = ["docstatus < 2", "is_cancelled = 0", "item_code IN %(item_codes)s"]
    trend_values = {
        "item_codes": item_codes,
        "start_date": start_date,
        "to_date": to_date
    }
    if warehouses:
        trend_conditions.append("warehouse IN %(warehouses)s")
        trend_values["warehouses"] = warehouses
    if company:
        trend_conditions.append("company = %(company)s")
        trend_values["company"] = company

    trend_data = frappe.db.sql(f"""
        SELECT
            SUBSTRING(posting_date, 1, 7) as month,
            SUM(CASE WHEN actual_qty > 0 THEN actual_qty ELSE 0 END) as receipts,
            SUM(CASE WHEN actual_qty < 0 THEN ABS(actual_qty) ELSE 0 END) as issues
        FROM `tabStock Ledger Entry`
        WHERE {" AND ".join(trend_conditions)}
          AND posting_date >= %(start_date)s
          AND posting_date <= %(to_date)s
        GROUP BY SUBSTRING(posting_date, 1, 7)
        ORDER BY month ASC
    """, trend_values, as_dict=True)

    import datetime
    trend_map = {row["month"]: row for row in trend_data}
    final_trend = []
    current_date = getdate(to_date)
    for i in range(5, -1, -1):
        m = current_date.month - i
        y = current_date.year
        while m <= 0:
            m += 12
            y -= 1
        month_str = f"{y:04d}-{m:02d}"
        
        row = trend_map.get(month_str, {"receipts": 0.0, "issues": 0.0})
        month_name = datetime.date(y, m, 1).strftime("%b %Y")
        
        final_trend.append({
            "month": month_str,
            "month_name": month_name,
            "receipts": flt(row["receipts"]),
            "issues": flt(row["issues"])
        })

    return {
        "kpis": {
            "total_qty": total_qty,
            "total_val": total_val,
            "reorder_level": total_reorder_level,
            "lead_time_days": lead_time_days
        },
        "ageing": {
            "0-30": age_buckets["0-30"],
            "30-60": age_buckets["30-60"],
            "60-90": age_buckets["60-90"],
            ">90": age_buckets[">90"]
        },
        "suppliers": suppliers,
        "reorders": reorders_list,
        "urgency_reorders": urgency_reorders,
        "currency": currency,
        "last_transaction_date": last_transaction_date,
        "warehouse_distribution": warehouse_distribution,
        "monthly_trend": final_trend
    }


@frappe.whitelist()
def get_daily_transactions(company=None, warehouse=None, item_group=None, item_code=None, from_date=None, to_date=None):
    """Sr. 1 & Sr. 2 — Daily Raw Material Issued and Received."""
    to_date = getdate(to_date) if to_date else getdate(today())
    from_date = getdate(from_date) if from_date else frappe.utils.add_days(to_date, -30)

    conditions = ["sle.docstatus < 2", "sle.is_cancelled = 0",
                  "sle.posting_date >= %(from_date)s", "sle.posting_date <= %(to_date)s"]
    values = {"from_date": from_date, "to_date": to_date}

    if company:
        conditions.append("sle.company = %(company)s")
        values["company"] = company

    if warehouse:
        wh_lft, wh_rgt = frappe.db.get_value("Warehouse", warehouse, ["lft", "rgt"])
        if wh_lft and wh_rgt:
            child_whs = frappe.db.get_all("Warehouse", filters={"lft": (">=", wh_lft), "rgt": ("<=", wh_rgt)}, pluck="name")
            conditions.append("sle.warehouse IN %(warehouses)s")
            values["warehouses"] = child_whs
        else:
            conditions.append("sle.warehouse = %(warehouse)s")
            values["warehouse"] = warehouse

    if item_code:
        conditions.append("sle.item_code = %(item_code)s")
        values["item_code"] = item_code
    elif item_group:
        ig_lft, ig_rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
        if ig_lft and ig_rgt:
            child_igs = frappe.db.get_all("Item Group", filters={"lft": (">=", ig_lft), "rgt": ("<=", ig_rgt)}, pluck="name")
            conditions.append("item.item_group IN %(item_groups)s")
            values["item_groups"] = child_igs
        else:
            conditions.append("item.item_group = %(item_group)s")
            values["item_group"] = item_group

    rows = frappe.db.sql(f"""
        SELECT
            sle.posting_date,
            sle.voucher_type,
            sle.voucher_no,
            sle.item_code,
            item.item_name,
            sle.warehouse,
            sle.actual_qty,
            ABS(sle.stock_value_difference) as value_change
        FROM `tabStock Ledger Entry` sle
        INNER JOIN `tabItem` item ON sle.item_code = item.name
        WHERE {" AND ".join(conditions)}
        ORDER BY sle.posting_date DESC, sle.creation DESC
        LIMIT 500
    """, values, as_dict=True)

    for row in rows:
        row["direction"] = "Received" if flt(row["actual_qty"]) > 0 else "Issued"
        row["actual_qty"] = flt(row["actual_qty"], 3)
        row["value_change"] = flt(row["value_change"], 2)

    return rows


@frappe.whitelist()
def get_material_fulfillment_data(company=None, warehouse=None, item_group=None, from_date=None, to_date=None):
    """Sr. 15 — Material Request Requested vs Issued Qty."""
    to_date = getdate(to_date) if to_date else getdate(today())
    from_date = getdate(from_date) if from_date else frappe.utils.add_months(to_date, -3)

    conditions = [
        "mri.docstatus = 1",
        "mr.docstatus = 1",
        "mr.transaction_date >= %(from_date)s",
        "mr.transaction_date <= %(to_date)s"
    ]
    values = {"from_date": from_date, "to_date": to_date}

    if company:
        conditions.append("mr.company = %(company)s")
        values["company"] = company

    if item_group:
        ig_lft, ig_rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
        if ig_lft and ig_rgt:
            child_igs = frappe.db.get_all("Item Group", filters={"lft": (">=", ig_lft), "rgt": ("<=", ig_rgt)}, pluck="name")
            conditions.append("item.item_group IN %(item_groups)s")
            values["item_groups"] = child_igs
        else:
            conditions.append("item.item_group = %(item_group)s")
            values["item_group"] = item_group

    rows = frappe.db.sql(f"""
        SELECT
            mr.name as mr_no,
            mr.transaction_date as mr_date,
            mr.material_request_type,
            mr.owner as requested_by,
            mri.item_code,
            item.item_name,
            item.item_group,
            mri.qty as requested_qty,
            mri.stock_uom,
            mri.warehouse as target_warehouse,
            mri.schedule_date as required_date,
            mri.production_plan,
            mr.work_order,
            IFNULL((
                SELECT SUM(sed.qty)
                FROM `tabStock Entry Detail` sed
                INNER JOIN `tabStock Entry` se ON sed.parent = se.name
                WHERE se.docstatus = 1
                  AND sed.material_request = mr.name
                  AND sed.item_code = mri.item_code
            ), 0) as issued_qty
        FROM `tabMaterial Request Item` mri
        INNER JOIN `tabMaterial Request` mr ON mri.parent = mr.name
        INNER JOIN `tabItem` item ON mri.item_code = item.name
        WHERE {" AND ".join(conditions)}
        ORDER BY mr.transaction_date DESC, mr.name
        LIMIT 1000
    """, values, as_dict=True)

    pending_count = 0
    partial_count = 0
    fulfilled_count = 0
    overdue_count = 0
    item_group_summary = {}
    purpose_summary = {}

    for row in rows:
        req = flt(row["requested_qty"], 3)
        issued = flt(row["issued_qty"], 3)
        row["requested_qty"] = req
        row["issued_qty"] = issued
        row["pending_qty"] = flt(max(0, req - issued), 3)
        row["pct_fulfilled"] = round((issued / req * 100), 1) if req > 0 else 0.0

        if issued <= 0:
            row["status"] = "Pending"
            pending_count += 1
        elif issued >= req:
            row["status"] = "Fulfilled"
            fulfilled_count += 1
        else:
            row["status"] = "Partial"
            partial_count += 1

        # Check for Overdue status
        days_overdue = 0
        is_overdue = False
        if row["status"] != "Fulfilled" and row["required_date"]:
            diff = date_diff(today(), row["required_date"])
            if diff > 0:
                days_overdue = diff
                is_overdue = True
                overdue_count += 1
        row["days_overdue"] = days_overdue
        row["is_overdue"] = is_overdue

        # Grouping aggregations for pending items
        if row["status"] != "Fulfilled":
            ig = row["item_group"] or "Not Specified"
            item_group_summary[ig] = item_group_summary.get(ig, 0) + 1
            
            purpose = row["material_request_type"] or "Not Specified"
            purpose_summary[purpose] = purpose_summary.get(purpose, 0) + 1

    ig_list = [{"item_group": k, "count": v} for k, v in item_group_summary.items()]
    ig_list.sort(key=lambda x: x["count"], reverse=True)

    purpose_list = [{"purpose": k, "count": v} for k, v in purpose_summary.items()]
    purpose_list.sort(key=lambda x: x["count"], reverse=True)

    kpis = {
        "total_items": len(rows),
        "pending_count": pending_count,
        "partial_count": partial_count,
        "fulfilled_count": fulfilled_count,
        "overdue_count": overdue_count
    }
    return {
        "items": rows,
        "kpis": kpis,
        "item_groups": ig_list[:10],
        "purposes": purpose_list[:10]
    }


@frappe.whitelist()
def create_shelf_life_test_data():
    """
    Creates test data for the Shelf Life & Expiry tab.
    Generates:
      - Clean up of previous bad test stock entries (with null batch_no in SLE)
      - 4 properly configured batch-tracked items with cleared cache
      - 1 batch per item covering each expiry status
      - Stock Ledger Entries for each batch with proper batch_no propagation
    """
    from frappe.utils import add_days, now_datetime
    import json

    results = []
    errors = []

    # ── 1. Clean up old/corrupted test entries ───────────────────────
    test_item_codes = ["TEST-BATCH-EPOXY", "TEST-BATCH-PAINT", "TEST-BATCH-GREASE", "TEST-BATCH-SEALANT"]
    
    # Find all stock entries that contain these items
    old_se_names = frappe.db.sql("""
        SELECT DISTINCT parent 
        FROM `tabStock Entry Detail` 
        WHERE item_code IN %(items)s
    """, {"items": test_item_codes}, pluck="parent")

    for se_name in old_se_names:
        # Find any linked Serial and Batch Bundles
        bundles = frappe.db.get_all("Serial and Batch Bundle", filters={"voucher_no": se_name}, pluck="name")
        
        docstatus = frappe.db.get_value("Stock Entry", se_name, "docstatus")
        if docstatus == 1:
            try:
                se_doc = frappe.get_doc("Stock Entry", se_name)
                se_doc.cancel()
                results.append(f"Cancelled old Stock Entry: {se_name}")
            except Exception as e:
                # Force docstatus update if standard cancel fails
                frappe.db.set_value("Stock Entry", se_name, "docstatus", 2)
        
        # Hard delete from DB to start fresh
        frappe.db.delete("Stock Ledger Entry", {"voucher_no": se_name})
        frappe.db.delete("Stock Entry Detail", {"parent": se_name})
        frappe.db.delete("Stock Entry", {"name": se_name})
        
        for bundle in bundles:
            frappe.db.delete("Serial and Batch Entry", {"parent": bundle})
            frappe.db.delete("Serial and Batch Bundle", {"name": bundle})
            
        results.append(f"Deleted old Stock Entry and bundle records: {se_name}")

    # Delete existing batches for these items
    frappe.db.delete("Batch", {"item": ["in", test_item_codes]})

    # ── 2. Discover Company & Warehouse ────────────────────────────
    company = frappe.db.get_value("Company", {"is_group": 0}, "name")
    if not company:
        frappe.throw("No Company found. Please create a Company first.")

    default_currency = frappe.get_cached_value("Company", company, "default_currency") or "INR"

    warehouse = frappe.db.get_value(
        "Warehouse",
        {"is_group": 0, "disabled": 0, "company": company},
        "name"
    )
    if not warehouse:
        warehouse = frappe.db.get_value("Warehouse", {"is_group": 0}, "name")
    if not warehouse:
        frappe.throw("No Warehouse found. Please create a Warehouse first.")

    item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"

    # ── 3. Test items (batch-tracked with expiry) ─────────────────
    test_items = [
        {"item_code": "TEST-BATCH-EPOXY",    "item_name": "Epoxy Resin (Test)",      "uom": "Kg"},
        {"item_code": "TEST-BATCH-PAINT",    "item_name": "Conductive Paint (Test)", "uom": "Litre"},
        {"item_code": "TEST-BATCH-GREASE",   "item_name": "Contact Grease (Test)",   "uom": "Kg"},
        {"item_code": "TEST-BATCH-SEALANT",  "item_name": "Silicone Sealant (Test)", "uom": "Nos"},
    ]

    uom_fallback = frappe.db.get_value("UOM", {}, "name") or "Nos"

    for item_def in test_items:
        item_code = item_def["item_code"]
        uom = item_def["uom"] if frappe.db.exists("UOM", item_def["uom"]) else uom_fallback
        
        if not frappe.db.exists("Item", item_code):
            try:
                item_dict = {
                    "doctype": "Item",
                    "item_code": item_code,
                    "item_name": item_def["item_name"],
                    "item_group": item_group,
                    "stock_uom": uom,
                    "is_stock_item": 1,
                    "has_batch_no": 1,
                    "has_expiry_date": 1,
                    "create_new_batch": 1,
                    "valuation_method": "FIFO"
                }
                
                item = frappe.get_doc(item_dict)
                item.insert(ignore_permissions=True)
                results.append(f"Created item: {item_code}")
            except Exception as e:
                errors.append(f"Item {item_code}: {str(e)}")
                continue
        else:
            # Force update of batch parameters via get_doc and save
            try:
                item_doc = frappe.get_doc("Item", item_code)
                item_doc.has_batch_no = 1
                item_doc.has_expiry_date = 1
                item_doc.create_new_batch = 1
                
                item_doc.save(ignore_permissions=True)
                results.append(f"Configured batch tracking for existing item: {item_code}")
            except Exception as e:
                errors.append(f"Configure item {item_code}: {str(e)}")
                continue

        # CRITICAL: Clear document cache so subsequent stock entry submission sees updated batch flags
        frappe.clear_document_cache("Item", item_code)

    # Clear general doctype cache
    frappe.clear_cache(doctype="Item")
    frappe.db.commit()

    # ── 4. Batch definitions (one per expiry bucket per item) ──────
    today_date = getdate(today())

    batch_scenarios = [
        {
            "suffix": "EXPIRED",
            "expiry_offset": -15,    # expired 15 days ago
            "qty": 25.0,
            "valuation_rate": 850.0,
            "label": "Expired"
        },
        {
            "suffix": "NEAR30",
            "expiry_offset": 20,     # expires in 20 days
            "qty": 40.0,
            "valuation_rate": 1200.0,
            "label": "Expiring <30 Days"
        },
        {
            "suffix": "NEAR90",
            "expiry_offset": 60,     # expires in 60 days
            "qty": 75.0,
            "valuation_rate": 950.0,
            "label": "Expiring <90 Days"
        },
        {
            "suffix": "SAFE",
            "expiry_offset": 180,    # expires in 180 days - safe
            "qty": 100.0,
            "valuation_rate": 1100.0,
            "label": "Safe"
        },
    ]

    for item_def in test_items:
        item_code = item_def["item_code"]
        if not frappe.db.exists("Item", item_code):
            continue

        uom = frappe.db.get_value("Item", item_code, "stock_uom") or uom_fallback

        for scenario in batch_scenarios:
            batch_id = f"{item_code}-{scenario['suffix']}"
            expiry_date = add_days(today_date, scenario["expiry_offset"])

            # Use a safe future expiry date temporarily for submission if target is in the past
            temp_expiry_date = expiry_date
            if scenario["expiry_offset"] < 0:
                temp_expiry_date = add_days(today_date, 30)

            # Create batch
            try:
                batch = frappe.get_doc({
                    "doctype": "Batch",
                    "batch_id": batch_id,
                    "item": item_code,
                    "expiry_date": temp_expiry_date,
                    "batch_qty": scenario["qty"],
                    "disabled": 0
                })
                batch.insert(ignore_permissions=True)
                results.append(f"Created batch: {batch_id} (temp expiry: {temp_expiry_date})")
            except Exception as e:
                errors.append(f"Batch {batch_id}: {str(e)}")
                continue

            # Create a Stock Entry (Material Receipt) to put stock into this batch
            try:
                from erpnext.stock.doctype.serial_and_batch_bundle.test_serial_and_batch_bundle import make_serial_batch_bundle
                
                # 1. Create the Serial and Batch Bundle for the receipt
                bundle_doc = make_serial_batch_bundle({
                    "item_code": item_code,
                    "warehouse": warehouse,
                    "voucher_type": "Stock Entry",
                    "qty": scenario["qty"],
                    "rate": scenario["valuation_rate"],
                    "batches": {batch_id: scenario["qty"]},
                    "type_of_transaction": "Inward",
                    "company": company,
                    "posting_date": today_date,
                    "posting_time": "12:00:00",
                    "do_not_submit": True
                })
                
                se = frappe.get_doc({
                    "doctype": "Stock Entry",
                    "stock_entry_type": "Material Receipt",
                    "company": company,
                    "posting_date": today_date,
                    "items": [{
                        "item_code": item_code,
                        "qty": scenario["qty"],
                        "t_warehouse": warehouse,
                        "serial_and_batch_bundle": bundle_doc.name,
                        "valuation_rate": scenario["valuation_rate"],
                        "uom": uom,
                        "stock_uom": uom,
                        "conversion_factor": 1.0,
                        "basic_rate": scenario["valuation_rate"],
                        "basic_amount": scenario["qty"] * scenario["valuation_rate"]
                    }]
                })
                se.insert(ignore_permissions=True)
                se.submit()
                results.append(f"Stock Entry submitted: {se.name} for batch {batch_id} ({scenario['qty']} {uom})")
            except Exception as e:
                errors.append(f"Stock Entry for {batch_id}: {str(e)}")
                continue

            # Post-submit: restore the true target expiry date (which could be in the past)
            frappe.db.set_value("Batch", batch_id, "expiry_date", expiry_date)

    frappe.db.commit()

    return {
        "success": len(errors) == 0,
        "created": results,
        "errors": errors,
        "summary": f"{len(results)} operations completed, {len(errors)} errors."
    }

@frappe.whitelist()
def get_abc_analysis_data(company, based_on, item_group=None, warehouse=None, from_date=None, to_date=None, class_a_limit=80.0, class_b_limit=15.0):
    from esoft_custom_bom.esoft_custom_bom.report.abc_analysis.abc_analysis import execute as run_abc
    filters = {
        "company": company,
        "based_on": based_on,
        "item_group": item_group,
        "warehouse": warehouse,
        "from_date": from_date,
        "to_date": to_date,
        "class_a_limit": flt(class_a_limit) if class_a_limit else 80.0,
        "class_b_limit": flt(class_b_limit) if class_b_limit else 15.0
    }
    columns, data, _, chart, report_summary = run_abc(filters)
    company_currency = frappe.get_cached_value("Company", company, "default_currency") if company else frappe.db.get_single_value("Global Defaults", "default_currency")
    return {
        "columns": columns,
        "data": data,
        "chart": chart,
        "report_summary": report_summary,
        "currency": company_currency
    }
