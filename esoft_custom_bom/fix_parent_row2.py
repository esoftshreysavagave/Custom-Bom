import frappe
def run():
    docnames = frappe.get_all("BOM Creator", pluck="name")
    for docname in docnames:
        doc = frappe.get_doc("BOM Creator", docname)
        if doc.docstatus == 1:
            continue
            
        changed = False
        
        # Build a list of items to match fg_item to item_code
        for row in doc.items:
            if row.fg_item == doc.item_code:
                # Top level item, should have NO parent_row_no
                if row.parent_row_no:
                    print(f"Row {row.idx} (item {row.item_code}): clearing Parent Row No (was {row.parent_row_no})")
                    row.parent_row_no = ""
                    changed = True
                continue
                
            # For child items, find the parent row
            # The parent row MUST have item_code == row.fg_item
            parent_candidates = [r for r in doc.items if r.item_code == row.fg_item]
            
            if not parent_candidates:
                print(f"Row {row.idx} (item {row.item_code}): WARNING no parent found with item_code {row.fg_item}")
                continue
                
            # If there's multiple candidates, let's just pick the first one for now,
            # or try to pick the one that occurs BEFORE this row
            valid_candidates = [r for r in parent_candidates if r.idx < row.idx]
            if not valid_candidates:
                valid_candidates = parent_candidates
                
            parent_row = valid_candidates[0]
            
            if str(row.parent_row_no) != str(parent_row.idx):
                print(f"Row {row.idx} (item {row.item_code}): changing Parent Row No from {row.parent_row_no} to {parent_row.idx}")
                row.parent_row_no = str(parent_row.idx)
                # Also fix fg_reference_id
                row.fg_reference_id = parent_row.name
                changed = True
                
        if changed:
            doc.flags.ignore_validate = True # Avoid standard validation for a moment if needed
            doc.save()
            frappe.db.commit()
            print(f"Fixed {doc.name}")

