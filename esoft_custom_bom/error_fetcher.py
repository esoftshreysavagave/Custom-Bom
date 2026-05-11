import frappe
def run():
    log = frappe.get_all("Error Log", fields=["error"], order_by="creation desc", limit=1)
    if log:
        print(log[0].error)
run()
