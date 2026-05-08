import frappe
def run():
    docnames = frappe.get_all("BOM Creator", pluck="name")
    for docname in docnames:
        doc = frappe.get_doc("BOM Creator", docname)
        if doc.docstatus == 1:
            continue # already submitted correctly
        
        changed = False
        name_to_idx = {r.name: r.idx for r in doc.items}
        
        for row in doc.items:
            if row.fg_reference_id and row.fg_reference_id in name_to_idx:
                correct_parent_idx = name_to_idx[row.fg_reference_id]
                if str(row.parent_row_no) != str(correct_parent_idx):
                    print(f"Row {row.idx} (item {row.item_code}): changing Parent Row No from {row.parent_row_no} to {correct_parent_idx}")
                    row.parent_row_no = str(correct_parent_idx)
                    changed = True

        if changed:
            if doc.docstatus != 0:
                frappe.db.set_value("BOM Creator", doc.name, "docstatus", 0)
                doc.docstatus = 0
            doc.save()
            frappe.db.commit()
            print(f"Fixed {doc.name}")
