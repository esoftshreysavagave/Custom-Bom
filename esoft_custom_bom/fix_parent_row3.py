import frappe
def run():
    docnames = frappe.get_all("BOM Creator", pluck="name")
    print(f"Found {len(docnames)} BOM Creators: {docnames}")
    for docname in docnames:
        doc = frappe.get_doc("BOM Creator", docname)
        print(f"Doc: {doc.name}, docstatus: {doc.docstatus}")
        
        changed = False
        
        for row in doc.items:
            if row.fg_item == doc.item_code:
                if row.parent_row_no:
                    print(f"Row {row.idx} (item {row.item_code}): clearing Parent Row No (was {row.parent_row_no})")
                    row.parent_row_no = ""
                    changed = True
                continue
                
            parent_candidates = [r for r in doc.items if r.item_code == row.fg_item]
            
            if not parent_candidates:
                print(f"Row {row.idx} (item {row.item_code}): WARNING no parent found with item_code {row.fg_item}")
                continue
                
            valid_candidates = [r for r in parent_candidates if r.idx < row.idx]
            if not valid_candidates:
                valid_candidates = parent_candidates
                
            parent_row = valid_candidates[0]
            
            if str(row.parent_row_no) != str(parent_row.idx):
                print(f"Row {row.idx} (item {row.item_code}): changing Parent Row No from {row.parent_row_no} to {parent_row.idx}")
                row.parent_row_no = str(parent_row.idx)
                row.fg_reference_id = parent_row.name
                changed = True
                
        if changed:
            frappe.db.set_value("BOM Creator", doc.name, "docstatus", 0)
            doc.docstatus = 0
            doc.save()
            frappe.db.commit()
            print(f"Fixed {doc.name}")

