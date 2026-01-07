import frappe
from erpnext.manufacturing.doctype.bom import bom

def custom_validate_bom_no(item, bom_no):
    # Check the flag
    if frappe.flags.get("allow_draft_subassembly_bom"):
        return
    
    # Logic from original function (avoiding circular reference)
    if not bom_no:
        return

    bom_data = frappe.db.get_value("BOM", bom_no, ["item", "docstatus"], as_dict=1)
    if not bom_data:
        frappe.throw(frappe._("BOM {0} does not exist").format(bom_no))

    if bom_data.item != item:
        frappe.throw(frappe._("BOM {0} does not belong to Item {1}").format(bom_no, item))

    # This is the line we are bypassing with the flag
    if bom_data.docstatus != 1:
        frappe.throw(frappe._("BOM {0} must be submitted").format(bom_no))

# Apply the monkey patch
bom.validate_bom_no = custom_validate_bom_no