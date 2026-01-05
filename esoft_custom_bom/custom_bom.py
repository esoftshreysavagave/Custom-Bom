import frappe
from erpnext.manufacturing.doctype.bom_creator.bom_creator import BOMCreator, BOM_FIELDS, BOM_ITEM_FIELDS

class CustomBOM(BOMCreator):
    def create_bom(self, row, production_item_wise_rm):
        bom_creator_item = row.name if row.name != self.name else ""
        
        if frappe.db.exists(
            "BOM",
            {
                "bom_creator": self.name,
                "item": row.item_code,
                "bom_creator_item": bom_creator_item,
                "docstatus": 1,
            },
        ):
            return

        bom = frappe.new_doc("BOM")
        bom.update(
            {
                "item": row.item_code,
                "bom_type": "Production",
                "quantity": row.qty,
                "bom_creator": self.name,
                "bom_creator_item": bom_creator_item,
            }
        )

        for field in BOM_FIELDS:
            if self.get(field):
                bom.set(field, self.get(field))

        for item in production_item_wise_rm[(row.item_code, row.name)]["items"]:
            bom_no = ""
            item.do_not_explode = 1
            if (item.item_code, item.name) in production_item_wise_rm:
                bom_no = production_item_wise_rm.get((item.item_code, item.name)).bom_no
                item.do_not_explode = 0

            item_args = {}
            for field in BOM_ITEM_FIELDS:
                item_args[field] = item.get(field)

            item_args.update(
                {
                    "bom_no": bom_no,
                    "allow_scrap_items": 1,
                    "include_item_in_manufacturing": 1,
                }
            )

            bom.append("items", item_args)

        bom.save(ignore_permissions=True)

        production_item_wise_rm[(row.item_code, row.name)].bom_no = bom.name