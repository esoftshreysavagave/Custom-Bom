import frappe
from erpnext.manufacturing.doctype.bom_creator.bom_creator import (
    BOMCreator,
    BOM_FIELDS,
    BOM_ITEM_FIELDS,
)
# Ensure the patch is loaded when this module is used
import esoft_custom_bom.patches.bom_validate 

class CustomBOM(BOMCreator):
    def validate_duplicate_item(self):
        # If same items added multiple times under same parent, raise error
        item_map = {}
        for row in self.items:
            if not row.fg_reference_id:
                continue

            key = (row.item_code, row.fg_reference_id)
            if key in item_map:
                # FIX: Handle case where parent is the root document (self.name)
                parent_item_code = None
                if row.fg_reference_id == self.name:
                    parent_item_code = self.item_code
                else:
                    # Search for parent item code in the items table
                    parent_item_code = next(
                        (item.item_code for item in self.items if item.name == row.fg_reference_id),
                        self.item_code # fallback if not found
                    )

                frappe.throw(
                    frappe._(
                        "Item {0} added multiple times under the same parent item {1} at rows {2} and {3}"
                    ).format(frappe.bold(row.item_code), frappe.bold(parent_item_code), item_map[key], row.idx),
                    title=frappe._("Duplicate Item Under Same Parent"),
                )
            else:
                item_map[key] = row.idx

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
            # Our custom hook in bom_handler.py will ALSO run here to fix any missing links!
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
def fix_duplicates(bom_creator):
    if not bom_creator:
        frappe.throw(_("Please provide a BOM Creator Name"))
        
    doc = frappe.get_doc("BOM Creator", bom_creator)
    item_map = {}
    to_remove = []
    
    for row in doc.items:
        key = (row.item_code, row.fg_reference_id)
        if key in item_map:
            # Add qty to existing row
            existing_row = item_map[key]
            existing_row.qty += row.qty
            to_remove.append(row)
            print(f"Merging row {row.idx} into row {existing_row.idx} (New Qty: {existing_row.qty})")
        else:
            item_map[key] = row
            
    if to_remove:
        for row in to_remove:
            doc.remove(row)
        doc.save()
        frappe.db.commit()
        print(f"Fixed {len(to_remove)} duplicate(s). You can now submit the document.")
    else:
        print("No duplicates found.")

@frappe.whitelist()
def create_boms(bom_creator):
    doc = frappe.get_doc("BOM Creator", bom_creator)
    # Ensure we use the custom class logic
    custom_doc = CustomBOM()
    custom_doc.__dict__.update(doc.__dict__)
    return custom_doc.create_boms()

@frappe.whitelist()
def fix_tree(bom_creator):
    if not bom_creator:
        frappe.throw(_("Please provide a BOM Creator Name"))
    doc = frappe.get_doc("BOM Creator", bom_creator)
    changed = False
    for row in doc.items:
        if row.fg_item == doc.item_code:
            if row.parent_row_no:
                row.parent_row_no = ""
                changed = True
            continue
        parent_candidates = [r for r in doc.items if r.item_code == row.fg_item]
        if not parent_candidates:
            continue
        valid_candidates = [r for r in parent_candidates if r.idx < row.idx]
        if not valid_candidates:
            valid_candidates = parent_candidates
        parent_row = valid_candidates[0]
        if str(row.parent_row_no) != str(parent_row.idx):
            row.parent_row_no = str(parent_row.idx)
            row.fg_reference_id = parent_row.name
            changed = True
    if changed:
        if doc.docstatus != 0:
            doc.db_set("docstatus", 0)
        doc.flags.ignore_validate = True
        doc.save(ignore_version=True)
        frappe.db.commit()
        print(f"Fixed tree for {doc.name}")
    else:
        print("No issues found in tree.")