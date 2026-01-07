app_name = "esoft_custom_bom"
app_title = "Esoft Custom Bom"
app_publisher = "administrator"
app_description = "Esoft custom bom app for draft boms"
app_email = "contact@erpdata.in"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "esoft_custom_bom",
# 		"logo": "/assets/esoft_custom_bom/logo.png",
# 		"title": "Esoft Custom Bom",
# 		"route": "/esoft_custom_bom",
# 		"has_permission": "esoft_custom_bom.api.permission.has_app_permission"
# 	}
# ]



app_include_py = [
    "esoft_custom_bom.custom_bom",
    "esoft_custom_bom.patches.bom_validate"
]



override_whitelisted_methods = {
    "erpnext.manufacturing.doctype.bom_creator.bom_creator.create_boms": "esoft_custom_bom.custom_bom.create_boms"
}


# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/esoft_custom_bom/css/esoft_custom_bom.css"
# app_include_js = "/assets/esoft_custom_bom/js/esoft_custom_bom.js"

# include js, css files in header of web template
# web_include_css = "/assets/esoft_custom_bom/css/esoft_custom_bom.css"
# web_include_js = "/assets/esoft_custom_bom/js/esoft_custom_bom.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "esoft_custom_bom/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "esoft_custom_bom/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "esoft_custom_bom.utils.jinja_methods",
# 	"filters": "esoft_custom_bom.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "esoft_custom_bom.install.before_install"
# after_install = "esoft_custom_bom.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "esoft_custom_bom.uninstall.before_uninstall"
# after_uninstall = "esoft_custom_bom.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "esoft_custom_bom.utils.before_app_install"
# after_app_install = "esoft_custom_bom.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "esoft_custom_bom.utils.before_app_uninstall"
# after_app_uninstall = "esoft_custom_bom.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "esoft_custom_bom.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

override_doctype_class = {
    "BOM Creator": "esoft_custom_bom.custom_bom.CustomBOM"
}

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
	# "*": {
	# 	"on_update": "method",
	# 	"on_cancel": "method",
	# 	"on_trash": "method"
	# }
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"esoft_custom_bom.tasks.all"
# 	],
# 	"daily": [
# 		"esoft_custom_bom.tasks.daily"
# 	],
# 	"hourly": [
# 		"esoft_custom_bom.tasks.hourly"
# 	],
# 	"weekly": [
# 		"esoft_custom_bom.tasks.weekly"
# 	],
# 	"monthly": [
# 		"esoft_custom_bom.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "esoft_custom_bom.install.before_tests"

# Overriding Methods
# ------------------------------
#

# override_whitelisted_methods = {
#     "erpnext.manufacturing.doctype.bom_creator.bom_creator.create_boms":
#         "esoft_custom_bom.custom_bom.create_boms"
# }

#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "esoft_custom_bom.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["esoft_custom_bom.utils.before_request"]
# after_request = ["esoft_custom_bom.utils.after_request"]

# Job Events
# ----------
# before_job = ["esoft_custom_bom.utils.before_job"]
# after_job = ["esoft_custom_bom.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"esoft_custom_bom.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

