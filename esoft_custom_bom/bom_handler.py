import frappe

def validate_sub_assemblies(doc, method):
    # Auto-link sub-assemblies and uncheck 'Do Not Explode' if a Default BOM exists
    for item in doc.items:
        # If the item has a Default BOM
        default_bom = frappe.db.get_value("Item", item.item_code, "default_bom")
        
        if default_bom:
            # If no BOM is linked, or if 'Do Not Explode' is blocking the link
            if not item.bom_no or item.do_not_explode:
                item.bom_no = default_bom
                item.do_not_explode = 0
                
                # Ensure it's marked as Included in Manufacturing
                item.include_item_in_manufacturing = 1
