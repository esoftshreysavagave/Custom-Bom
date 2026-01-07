# esoft_custom_bom/hooks_handlers/bom.py

import frappe

_TEMP_KEY = "_draft_subassembly_boms"


def before_validate(doc, method):
    if not frappe.flags.get("allow_draft_subassembly_bom"):
        return

    # store bom_no temporarily
    temp = {}

    for row in doc.items:
        if row.bom_no:
            temp[row.name] = row.bom_no
            row.bom_no = None

    doc.flags[_TEMP_KEY] = temp


def after_insert(doc, method):
    temp = doc.flags.get(_TEMP_KEY)
    if not temp:
        return

    for row in doc.items:
        if row.name in temp:
            row.db_set("bom_no", temp[row.name], update_modified=False)
