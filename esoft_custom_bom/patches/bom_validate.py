import frappe
from erpnext.manufacturing.doctype.bom import bom

def custom_validate_bom_no(item, bom_no):
    """
    STRICTER PATCH: Bypasses the 'must be submitted' check 
    if the allow_draft_subassembly_bom flag is set.
    """
    if not bom_no:
        return

    # Check the bypass flag first (highest priority)
    if frappe.flags.get("allow_draft_subassembly_bom"):
        return

    bom_data = frappe.db.get_value("BOM", bom_no, ["item", "docstatus", "bom_creator"], as_dict=1)
    if not bom_data:
        frappe.throw(frappe._("BOM {0} does not exist").format(bom_no))

    if bom_data.item != item:
        frappe.throw(frappe._("BOM {0} does not belong to Item {1}").format(bom_no, item))

    # Allow if it's a Draft BOM created by the same BOM Creator job
    if bom_data.docstatus == 0 and bom_data.bom_creator:
        return

    if bom_data.docstatus != 1:
        frappe.throw(frappe._("BOM {0} must be submitted").format(bom_no))

# APPLY THE PATCH TO MULTIPLE PLACES TO BE SAFE
# 1. Patch the module member
bom.validate_bom_no = custom_validate_bom_no

# 2. Patch the controller method if it exists
if hasattr(bom.BOM, "validate_bom_no"):
    bom.BOM.validate_bom_no = staticmethod(custom_validate_bom_no)