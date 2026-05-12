import frappe
from frappe import _

def before_validate(doc, method):
    """
    SIMPLE & STRONG: This is the version that worked perfectly.
    It links the sub-assemblies and relies on the Patch to allow Drafts.
    """
    # 1. Enable the bypass flag (The Nuclear Patch will see this)
    if doc.bom_creator:
        frappe.flags.allow_draft_subassembly_bom = True
        
    # 2. Automatically link the sub-assemblies
    if not doc.items:
        return

    for item in doc.items:
        if not item.bom_no:
            # Check for Default BOM or Draft BOM from same creator
            bom_no = frappe.db.get_value("Item", item.item_code, "default_bom")
            if not bom_no and getattr(doc, "bom_creator", None):
                bom_no = frappe.db.get_value("BOM", {
                    "item": item.item_code,
                    "bom_creator": doc.bom_creator,
                    "docstatus": 0
                }, "name")

            if bom_no:
                item.bom_no = bom_no

        # Fix visibility flags for Production Plan
        if item.bom_no:
            item.do_not_explode = 0
            item.include_item_in_manufacturing = 1
            
def after_insert(doc, method):
    # Cleanup flag
    frappe.flags.allow_draft_subassembly_bom = False
