import frappe
from erpnext.manufacturing.doctype.bom_creator.bom_creator import (
    BOMCreator,
    BOM_FIELDS,
    BOM_ITEM_FIELDS,
)
# Ensure the patch is loaded when this module is used
import esoft_custom_bom.patches.bom_validate 

class CustomBOM(BOMCreator):
    def create_boms(self):
        # We call the standard create_boms but the create_bom 
        # (singular) method called inside will be our overridden one.
        super().create_boms()

    def create_bom(self, row, production_item_wise_rm):
        bom_creator_item = row.name if row.name != self.name else ""

        # Check if a draft or submitted BOM already exists for this creator item
        existing_bom = frappe.db.exists(
            "BOM",
            {
                "bom_creator": self.name,
                "item": row.item_code,
                "bom_creator_item": bom_creator_item,
            },
        )
        if existing_bom:
            production_item_wise_rm[(row.item_code, row.name)].bom_no = existing_bom
            return

        bom = frappe.new_doc("BOM")
        bom.update({
            "item": row.item_code,
            "bom_type": "Production",
            "quantity": row.qty,
            "bom_creator": self.name,
            "bom_creator_item": bom_creator_item,
        })

        # Copy standard BOM fields from BOM Creator Header
        for field in BOM_FIELDS:
            if self.get(field):
                bom.set(field, self.get(field))

        # Add Items
        items_data = production_item_wise_rm.get((row.item_code, row.name), {}).get("items", [])
        for item in items_data:
            bom_no = ""
            
            # Check if this item is a sub-assembly in our current tree
            if (item.item_code, item.name) in production_item_wise_rm:
                bom_no = production_item_wise_rm[(item.item_code, item.name)].get("bom_no")
            
            item_args = {}
            for field in BOM_ITEM_FIELDS:
                item_args[field] = item.get(field)

            item_args.update({
                "bom_no": bom_no,
                "allow_scrap_items": 1,
                "include_item_in_manufacturing": 1,
            })
            bom.append("items", item_args)

        # Use the flag to bypass the "Must be submitted" validation
        frappe.flags.allow_draft_subassembly_bom = True
        try:
            bom.insert(ignore_permissions=True)
            # We do NOT call bom.submit() here, keeping it in Draft
        except Exception:
            frappe.log_error("Custom BOM Creator Error")
            raise
        finally:
            frappe.flags.allow_draft_subassembly_bom = False

        # Store the new BOM name so parent items can find it
        production_item_wise_rm[(row.item_code, row.name)].bom_no = bom.name

@frappe.whitelist()
def create_boms(bom_creator):
    doc = frappe.get_doc("BOM Creator", bom_creator)
    # Ensure we use the custom class logic
    custom_doc = CustomBOM()
    custom_doc.__dict__.update(doc.__dict__)
    return custom_doc.create_boms()