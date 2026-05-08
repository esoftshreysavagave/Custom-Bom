import frappe
from frappe import _

def validate_sub_assemblies(doc, method):
    """
    Hooked on BOM 'validate' event.
    Automatically links sub-assemblies and fixes common configuration issues 
    that cause failures in the Production Plan and BOM Creator.
    """
    if not doc.items:
        return

    for item in doc.items:
        # 1. Fetch Default BOM if not already set
        if not item.bom_no:
            default_bom = frappe.db.get_value("Item", item.item_code, "default_bom")
            if default_bom:
                item.bom_no = default_bom
                frappe.msgprint(
                    _("Row {0}: Automatically linked Default BOM {1} for Item {2}")
                    .format(item.idx, frappe.bold(default_bom), frappe.bold(item.item_code)),
                    alert=True
                )

        # 2. Fix 'Do Not Explode' flag
        # If an item is a sub-assembly (has a BOM), it MUST NOT have 'Do Not Explode' checked
        # otherwise the Production Plan 'Get Sub Assembly Item' will fail to see its requirements.
        if item.bom_no and item.do_not_explode:
            item.do_not_explode = 0
            frappe.msgprint(
                _("Row {0}: Unchecked 'Do Not Explode' for Sub-Assembly {1} to ensure visibility in Production Plan.")
                .format(item.idx, frappe.bold(item.item_code)),
                alert=True
            )

        # 3. Ensure 'Include Item in Manufacturing' is checked
        if item.bom_no and not item.include_item_in_manufacturing:
            item.include_item_in_manufacturing = 1

    # 4. Final check: Warn if a sub-assembly item still has no BOM
    # This prevents the "Raw Materials cannot be blank" error during background processing
    for item in doc.items:
        is_sub_assembly = frappe.db.get_value("Item", item.item_code, "is_sub_assembly_item")
        if is_sub_assembly and not item.bom_no:
            frappe.msgprint(
                _("Warning: Row {0} ({1}) is a sub-assembly but has no BOM linked. This may cause errors during submission.")
                .format(item.idx, item.item_code),
                indicator='orange'
            )
