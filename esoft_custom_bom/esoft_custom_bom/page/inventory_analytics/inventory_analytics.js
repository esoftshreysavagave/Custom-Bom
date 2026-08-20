// Copyright (c) 2026, Abdul Mannan and contributors
// For license information, please see license.txt

frappe.pages["inventory-analytics"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Inventory & Lifecycle Analytics"),
        single_column: true
    });
    
    // Scope jQuery selectors to this page wrapper to prevent conflicts with other pages in DOM
    var $wrapper = $(wrapper);
    
    // Main container for the dashboard content
    var main_container = $('<div class="inventory-analytics-dashboard"></div>').appendTo(page.main);
    
    // Inject custom CSS styles for clean tabs, KPIs, charts, and table
    inject_styles();
    
    // Active tab state: valuation (default), slow_moving, expiry
    let active_tab = "valuation";
    let current_sort = { key: "bal_val", asc: false };
    let updating_sort_dropdown = false; // Flag to prevent recursion loop during programmatic select change
    let is_updating_from_date = false;
    let should_update_from_date = false;
    let last_filters = {
        company: null,
        warehouse: null,
        item_group: null,
        item: null
    };
    
    // Pre-declare filter variables to avoid Temporal Dead Zone (TDZ) ReferenceErrors in callbacks
    let company_filter, warehouse_filter, item_group_filter, item_filter, from_date_filter, to_date_filter;
    let abc_based_on_filter, class_a_limit_filter, class_b_limit_filter, sort_filter;

    // Define filters in the top filter bar


    company_filter = page.add_field({
        fieldname: "company",
        label: __("Company"),
        fieldtype: "Link",
        options: "Company",
        default: frappe.defaults.get_user_default("Company"),
        change: () => refresh_data()
    });
    
    warehouse_filter = page.add_field({
        fieldname: "warehouse",
        label: __("Warehouse"),
        fieldtype: "Link",
        options: "Warehouse",
        change: () => refresh_data()
    });
    
    item_group_filter = page.add_field({
        fieldname: "item_group",
        label: __("Item Group"),
        fieldtype: "Link",
        options: "Item Group",
        change: () => refresh_data()
    });
    
    item_filter = page.add_field({
        fieldname: "item",
        label: __("Item"),
        fieldtype: "Link",
        options: "Item",
        change: () => refresh_data()
    });
    item_filter.toggle(false);
    
    from_date_filter = page.add_field({
        fieldname: "from_date",
        label: __("From Date"),
        fieldtype: "Date",
        default: frappe.datetime.add_months(frappe.datetime.get_today(), -3),
        change: function() {
            if (is_updating_from_date) return;
            refresh_data();
        }
    });
    
    to_date_filter = page.add_field({
        fieldname: "to_date",
        label: __("To Date"),
        fieldtype: "Date",
        default: frappe.datetime.get_today(),
        change: () => refresh_data()
    });
    
    abc_based_on_filter = page.add_field({
        fieldname: "abc_based_on",
        label: __("Based On"),
        fieldtype: "Select",
        options: [
            "Stock Value",
            "Stock Quantity",
            "Consumption Value",
            "Consumption Quantity",
            "Sales Value",
            "Sales Quantity"
        ],
        default: "Stock Value",
        change: function() {
            let based_on = this.get_value() || "";
            if (from_date_filter) {
                from_date_filter.toggle(!based_on.startsWith("Stock"));
            }
            refresh_data();
        }
    });
    abc_based_on_filter.toggle(false);

    class_a_limit_filter = page.add_field({
        fieldname: "class_a_limit",
        label: __("Class A Limit (%)"),
        fieldtype: "Float",
        default: 80.0,
        change: () => refresh_data()
    });
    class_a_limit_filter.toggle(false);

    class_b_limit_filter = page.add_field({
        fieldname: "class_b_limit",
        label: __("Class B Limit (%)"),
        fieldtype: "Float",
        default: 15.0,
        change: () => refresh_data()
    });
    class_b_limit_filter.toggle(false);
    
    // Sort By Filter placed on top for maximum visibility
    sort_filter = page.add_field({
        fieldname: "sort_by",
        label: __("Sort By"),
        fieldtype: "Select",
        options: [
            __("Stock Value (High to Low)"),
            __("Stock Value (Low to High)"),
            __("Balance Qty (High to Low)"),
            __("Balance Qty (Low to High)"),
            __("Item Code (A-Z)"),
            __("Item Code (Z-A)")
        ],
        default: __("Stock Value (High to Low)"),
        change: function() {
            if (updating_sort_dropdown) return;
            
            let val = this.get_value();
            if (!val) return;
            
            if (val === __("Stock Value (High to Low)")) {
                current_sort = { key: "bal_val", asc: false };
            } else if (val === __("Stock Value (Low to High)")) {
                current_sort = { key: "bal_val", asc: true };
            } else if (val === __("Balance Qty (High to Low)")) {
                current_sort = { key: "bal_qty", asc: false };
            } else if (val === __("Balance Qty (Low to High)")) {
                current_sort = { key: "bal_qty", asc: true };
            } else if (val === __("Item Code (A-Z)")) {
                current_sort = { key: "item_code", asc: true };
            } else if (val === __("Item Code (Z-A)")) {
                current_sort = { key: "item_code", asc: false };
            } else if (val === __("Inactivity Days (High to Low)")) {
                current_sort = { key: "days_inactive", asc: false };
            } else if (val === __("Inactivity Days (Low to High)")) {
                current_sort = { key: "days_inactive", asc: true };
            } else if (val === __("Days to Expiry (Soonest first)")) {
                current_sort = { key: "days_to_expiry", asc: true };
            } else if (val === __("Days to Expiry (Latest first)")) {
                current_sort = { key: "days_to_expiry", asc: false };
            } else if (val === __("Batch Value (High to Low)")) {
                current_sort = { key: "bal_val", asc: false };
            } else if (val === __("Batch Qty (High to Low)")) {
                current_sort = { key: "bal_qty", asc: false };
            } else if (val === __("Value (High to Low)")) {
                current_sort = { key: "value", asc: false };
            } else if (val === __("Value (Low to High)")) {
                current_sort = { key: "value", asc: true };
            } else if (val === __("Qty (High to Low)")) {
                current_sort = { key: "qty", asc: false };
            } else if (val === __("Qty (Low to High)")) {
                current_sort = { key: "qty", asc: true };
            } else if (val === __("ABC Class (A to C)")) {
                current_sort = { key: "abc_class", asc: true };
            }
            sort_and_render();
        }
    });
    
    // Add primary actions (Refresh, Export)
    page.set_primary_action(__("Refresh"), () => refresh_data(), "refresh");
    page.set_secondary_action(__("Export CSV"), () => export_to_csv(), "download");
    
    // Setup dashboard base HTML structure
    main_container.html(`
        <!-- Tabbed Header Interface -->
        <div class="tabs-container">
            <button class="tab-btn active" data-tab="valuation">
                <i class="fa fa-line-chart"></i> ${__("Valuation & Quantity")}
            </button>
            <button class="tab-btn" data-tab="slow_moving">
                <i class="fa fa-hourglass-half"></i> ${__("Slow & Non-Moving Stock")}
            </button>
            <button class="tab-btn" data-tab="expiry">
                <i class="fa fa-calendar-times-o"></i> ${__("Shelf Life & Expiry")}
            </button>
            <button class="tab-btn" data-tab="item_analysis">
                <i class="fa fa-search-plus"></i> ${__("Item / Group Analysis")}
            </button>
            <button class="tab-btn" data-tab="abc_analysis">
                <i class="fa fa-cubes"></i> ${__("ABC Classification")}
            </button>
            <button class="tab-btn" data-tab="fulfillment">
                <i class="fa fa-check-square-o"></i> ${__("Material Requests (MR)")}
            </button>
        </div>

        <!-- Dynamic KPI Cards Grid -->
        <div class="kpi-grid" id="kpi-container">
            <!-- KPIs are dynamically rendered here -->
        </div>

        <!-- Custom SaaS-Style Interactive Visualization Widgets Grid -->
        <div class="charts-grid">
            <!-- Widget 1: Dynamic Metric Ranking List -->
            <div class="chart-card">
                <div class="chart-header">
                    <span class="chart-title" id="widget-ranking-title">Top Items by Valuation</span>
                </div>
                <div id="widget-ranking-content" class="widget-ranking-container">
                    <!-- Progress bars rendered here -->
                </div>
            </div>
            
            <!-- Widget 2: Interactive SVG Donut & Legend Ring -->
            <div class="chart-card">
                <div class="chart-header">
                    <span class="chart-title" id="widget-donut-title">Warehouse Valuation Distribution</span>
                </div>
                <div id="widget-donut-content" class="widget-donut-container">
                    <!-- Donut SVG & interactive legend rendered here -->
                </div>
            </div>
        </div>
        


        <!-- Search & Info Panel -->
        <div class="panel-header">
            <div class="search-box-wrapper">
                <input type="text" id="item-search-input" class="form-control item-search-input" placeholder="${__("Search by Item Code, Name or Group...")}" />
                <i class="fa fa-search search-icon"></i>
            </div>
            <div id="table-filter-info" class="table-filter-info"></div>
            <div id="results-count" class="results-count">Showing 0 items</div>
        </div>
        
        <!-- Table Area -->
        <div class="table-container">
            <table class="inventory-table" id="inventory-table">
                <thead id="inventory-table-head">
                    <!-- Headers are dynamically rendered here -->
                </thead>
                <tbody id="inventory-table-body">
                    <tr>
                        <td colspan="10" class="text-center text-muted">Loading data...</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `);
    
    // Local state variables
    let report_data = [];
    let filtered_table_data = [];
    let local_sub_filter = null; // Used when clicking on donut slices to filter table locally
    let raw_fulfillment_data = null; // Store fulfillment data from server
    let current_page = 1;
    let page_size = 20;
    
    // Get active metric details for dynamic labels & calculations
    function get_active_metric_details() {
        let key = current_sort.key;
        let label = __("Stock Value");
        let is_currency = true;
        
        if (active_tab === "valuation") {
            if (key === "bal_qty") { label = __("Balance Qty"); is_currency = false; }
            else if (key === "opening_qty") { label = __("Opening Qty"); is_currency = false; }
            else if (key === "in_qty") { label = __("In Qty"); is_currency = false; }
            else if (key === "out_qty") { label = __("Out Qty"); is_currency = false; }
            else if (key === "val_rate") { label = __("Valuation Rate"); }
            else { label = __("Stock Value"); key = "bal_val"; }
        } 
        else if (active_tab === "slow_moving") {
            if (key === "days_inactive") { label = __("Days Inactive"); is_currency = false; }
            else if (key === "bal_qty") { label = __("Qty"); is_currency = false; }
            else { label = __("Stock Value"); key = "bal_val"; }
        } 
        else if (active_tab === "expiry") {
            if (key === "days_to_expiry") { label = __("Days to Expiry"); is_currency = false; }
            else if (key === "bal_qty") { label = __("Batch Qty"); is_currency = false; }
            else { label = __("Batch Value"); key = "bal_val"; }
        }
        else if (active_tab === "abc_analysis") {
            let based_on = abc_based_on_filter ? abc_based_on_filter.get_value() : "Stock Value";
            let is_qty = based_on.includes("Quantity");
            if (key === "qty") { label = __("Quantity"); is_currency = false; }
            else if (key === "value") { label = __("Value"); is_currency = true; }
            else if (key === "abc_class") { label = __("ABC Class"); is_currency = false; }
            else {
                label = is_qty ? __("Quantity") : __("Value");
                key = is_qty ? "qty" : "value";
                is_currency = !is_qty;
            }
        }
        
        return { key, label, is_currency };
    }
    
    // Populate Top Filter Sort Dropdown Options based on Tab
    function update_sort_dropdown_options() {
        updating_sort_dropdown = true;
        let options = [];
        let default_val = "";
        
        if (active_tab === "valuation") {
            options = [
                __("Stock Value (High to Low)"),
                __("Stock Value (Low to High)"),
                __("Balance Qty (High to Low)"),
                __("Balance Qty (Low to High)"),
                __("Item Code (A-Z)"),
                __("Item Code (Z-A)")
            ];
            
            if (current_sort.key === "bal_val") {
                default_val = current_sort.asc ? __("Stock Value (Low to High)") : __("Stock Value (High to Low)");
            } else if (current_sort.key === "bal_qty") {
                default_val = current_sort.asc ? __("Balance Qty (Low to High)") : __("Balance Qty (High to Low)");
            } else if (current_sort.key === "item_code") {
                default_val = current_sort.asc ? __("Item Code (A-Z)") : __("Item Code (Z-A)");
            } else {
                default_val = __("Stock Value (High to Low)");
            }
        } 
        else if (active_tab === "slow_moving") {
            options = [
                __("Inactivity Days (High to Low)"),
                __("Inactivity Days (Low to High)"),
                __("Stock Value (High to Low)"),
                __("Balance Qty (High to Low)")
            ];
            
            if (current_sort.key === "days_inactive") {
                default_val = current_sort.asc ? __("Inactivity Days (Low to High)") : __("Inactivity Days (High to Low)");
            } else if (current_sort.key === "bal_val") {
                default_val = __("Stock Value (High to Low)");
            } else if (current_sort.key === "bal_qty") {
                default_val = __("Balance Qty (High to Low)");
            } else {
                default_val = __("Inactivity Days (High to Low)");
            }
        } 
        else if (active_tab === "expiry") {
            options = [
                __("Days to Expiry (Soonest first)"),
                __("Days to Expiry (Latest first)"),
                __("Batch Value (High to Low)"),
                __("Batch Qty (High to Low)")
            ];
            
            if (current_sort.key === "days_to_expiry") {
                default_val = current_sort.asc ? __("Days to Expiry (Soonest first)") : __("Days to Expiry (Latest first)");
            } else if (current_sort.key === "bal_val") {
                default_val = __("Batch Value (High to Low)");
            } else if (current_sort.key === "bal_qty") {
                default_val = __("Batch Qty (High to Low)");
            } else {
                default_val = __("Days to Expiry (Soonest first)");
            }
        }
        else if (active_tab === "abc_analysis") {
            options = [
                __("Value (High to Low)"),
                __("Value (Low to High)"),
                __("Qty (High to Low)"),
                __("Qty (Low to High)"),
                __("ABC Class (A to C)"),
                __("Item Code (A-Z)")
            ];
            
            if (current_sort.key === "value") {
                default_val = current_sort.asc ? __("Value (Low to High)") : __("Value (High to Low)");
            } else if (current_sort.key === "qty") {
                default_val = current_sort.asc ? __("Qty (Low to High)") : __("Qty (High to Low)");
            } else if (current_sort.key === "abc_class") {
                default_val = __("ABC Class (A to C)");
            } else if (current_sort.key === "item_code") {
                default_val = __("Item Code (A-Z)");
            } else {
                default_val = __("Value (High to Low)");
            }
        }
        
        if (sort_filter) {
            sort_filter.df.options = options;
            sort_filter.refresh();
        }
        sort_filter.set_value(default_val);
        updating_sort_dropdown = false;
    }
    // Tab switching event handlers
    $wrapper.on("click", ".tab-btn", function() {
        $wrapper.find(".tab-btn").removeClass("active");
        $(this).addClass("active");
        active_tab = $(this).attr("data-tab");
        
        // Reset local sub-filter and search input on switching tabs
        local_sub_filter = null;
        $wrapper.find("#item-search-input").val("");
        
        // Set default sorting key depending on the tab
        if (active_tab === "valuation") {
            current_sort = { key: "bal_val", asc: false };
        } else if (active_tab === "slow_moving") {
            current_sort = { key: "days_inactive", asc: false };
        } else if (active_tab === "expiry") {
            current_sort = { key: "days_to_expiry", asc: true };
        } else if (active_tab === "item_analysis") {
            current_sort = { key: "item_code", asc: true };
        } else if (active_tab === "fulfillment") {
            current_sort = { key: "mr_date", asc: false };
            is_updating_from_date = true;
            from_date_filter.set_value(frappe.datetime.add_months(to_date_filter.get_value(), -3));
            is_updating_from_date = false;
        }
        
        if (active_tab !== "item_analysis") {
            update_sort_dropdown_options();
        }
        refresh_data();
    });
    
    // Bind search keyup
    $wrapper.on("keyup", "#item-search-input", function() {
        sort_and_render();
    });
    // Toggle filters based on current tab
    function toggle_filters_by_tab() {
        if (page.clear_inner_buttons) {
            page.clear_inner_buttons();
        }
        
        // Toggle ABC Classification filters
        if (abc_based_on_filter) abc_based_on_filter.toggle(active_tab === "abc_analysis");
        if (class_a_limit_filter) class_a_limit_filter.toggle(active_tab === "abc_analysis");
        if (class_b_limit_filter) class_b_limit_filter.toggle(active_tab === "abc_analysis");

        if (active_tab === "abc_analysis") {
            if (item_filter) item_filter.toggle(false);
            if (sort_filter) sort_filter.toggle(true);
            if (from_date_filter && abc_based_on_filter) {
                let based_on = abc_based_on_filter.get_value() || "";
                from_date_filter.toggle(!based_on.startsWith("Stock"));
            }
            if (to_date_filter) to_date_filter.toggle(true);
            $wrapper.find(".panel-header").show();
            $wrapper.find("#widget-item-group-card").hide();
            $wrapper.find("#widget-purpose-card").hide();
        } else if (active_tab === "item_analysis") {
            if (item_filter) item_filter.toggle(true);
            if (sort_filter) sort_filter.toggle(false);
            if (from_date_filter) from_date_filter.toggle(true);
            if (to_date_filter) to_date_filter.toggle(true);
            $wrapper.find(".panel-header").hide();
            $wrapper.find("#widget-item-group-card").hide();
            $wrapper.find("#widget-purpose-card").hide();
        } else if (active_tab === "fulfillment") {
            if (item_filter) item_filter.toggle(false);
            if (sort_filter) sort_filter.toggle(false);
            if (from_date_filter) from_date_filter.toggle(true);
            if (to_date_filter) to_date_filter.toggle(true);
            $wrapper.find(".panel-header").show();
            $wrapper.find("#widget-item-group-card").show();
            $wrapper.find("#widget-purpose-card").show();
        } else {
            if (item_filter) item_filter.toggle(false);
            if (sort_filter) sort_filter.toggle(true);
            if (from_date_filter) from_date_filter.toggle(true);
            if (to_date_filter) to_date_filter.toggle(true);
            $wrapper.find(".panel-header").show();
            $wrapper.find("#widget-item-group-card").hide();
            $wrapper.find("#widget-purpose-card").hide();
        }
    }

    // Fetch and render data from backend
    function refresh_data() {
        toggle_filters_by_tab();
        
        let current_company = company_filter.get_value();
        let current_warehouse = warehouse_filter.get_value();
        let current_item_group = item_group_filter.get_value();
        let current_item = item_filter ? item_filter.get_value() : null;

        let filters_changed = (
            current_company !== last_filters.company ||
            current_warehouse !== last_filters.warehouse ||
            current_item_group !== last_filters.item_group ||
            current_item !== last_filters.item
        );

        if (filters_changed) {
            should_update_from_date = true;
            last_filters.company = current_company;
            last_filters.warehouse = current_warehouse;
            last_filters.item_group = current_item_group;
            last_filters.item = current_item;
        }
        
        if (active_tab === "item_analysis") {
            let filters = {
                company: company_filter.get_value(),
                warehouse: warehouse_filter.get_value(),
                item_group: item_group_filter.get_value(),
                item_code: item_filter.get_value(),
                to_date: to_date_filter.get_value()
            };
            
            $wrapper.find("#kpi-container").html(`<div class="text-center text-muted w-100 py-3">${__("Loading analysis...")}</div>`);
            $wrapper.find(".charts-grid").hide();
            $wrapper.find(".table-container").html(`<div class="text-center text-muted py-5">${__("Loading...")}</div>`);
            
            frappe.call({
                method: "esoft_custom_bom.esoft_custom_bom.page.inventory_analytics.inventory_analytics.get_item_analysis_data",
                args: filters,
                callback: function(r) {
                    if (r.message) {
                        if (should_update_from_date && r.message.last_transaction_date) {
                            is_updating_from_date = true;
                            from_date_filter.set_value(r.message.last_transaction_date);
                            is_updating_from_date = false;
                            should_update_from_date = false;
                        }
                        render_item_analysis_tab(r.message);
                    }
                }
            });
            return;
        }

        if (active_tab === "fulfillment") {
            let filters = {
                company: company_filter.get_value(),
                warehouse: warehouse_filter.get_value(),
                item_group: item_group_filter.get_value(),
                from_date: from_date_filter.get_value(),
                to_date: to_date_filter.get_value()
            };
            $wrapper.find("#kpi-container").html(`<div class="text-center text-muted w-100 py-3">${__("Loading...")}</div>`);
            $wrapper.find(".charts-grid").hide();
            $wrapper.find(".table-container").html(`<div class="text-center text-muted py-5">${__("Loading...")}</div>`);

            frappe.call({
                method: "esoft_custom_bom.esoft_custom_bom.page.inventory_analytics.inventory_analytics.get_material_fulfillment_data",
                args: filters,
                callback: function(r) {
                    if (r.message) {
                        raw_fulfillment_data = r.message;
                        render_fulfillment_tab(r.message);
                    }
                }
            });
            return;
        }

        if (active_tab === "abc_analysis") {
            let filters = {
                company: company_filter.get_value(),
                based_on: abc_based_on_filter.get_value(),
                item_group: item_group_filter.get_value(),
                warehouse: warehouse_filter.get_value(),
                from_date: from_date_filter.get_value(),
                to_date: to_date_filter.get_value(),
                class_a_limit: class_a_limit_filter.get_value(),
                class_b_limit: class_b_limit_filter.get_value()
            };
            
            $wrapper.find("#kpi-container").html(`<div class="text-center text-muted w-100 py-3">${__("Loading ABC classification...")}</div>`);
            $wrapper.find(".charts-grid").show();
            
            let container = $wrapper.find(".table-container");
            if (container.find("#inventory-table").length === 0) {
                container.html(`
                    <table class="inventory-table" id="inventory-table">
                        <thead id="inventory-table-head">
                            <!-- Headers are dynamically rendered here -->
                        </thead>
                        <tbody id="inventory-table-body">
                            <tr>
                                <td colspan="11" class="text-center text-muted">${__("Loading data...")}</td>
                            </tr>
                        </tbody>
                    </table>
                `);
            } else {
                $wrapper.find("#inventory-table-body").html(`
                    <tr>
                        <td colspan="11" class="text-center text-muted">${__("Loading data...")}</td>
                    </tr>
                `);
            }
            
            frappe.call({
                method: "esoft_custom_bom.esoft_custom_bom.page.inventory_analytics.inventory_analytics.get_abc_analysis_data",
                args: filters,
                callback: function(r) {
                    if (r.message) {
                        report_data = r.message.data;
                        update_kpis(r.message.report_summary, r.message.currency);
                        sort_and_render();
                    }
                }
            });
            return;
        }

        // Show regular grids for other tabs
        $wrapper.find(".charts-grid").show();
        let container = $wrapper.find(".table-container");
        if (container.find("#inventory-table").length === 0) {
            container.html(`
                <table class="inventory-table" id="inventory-table">
                    <thead id="inventory-table-head">
                        <!-- Headers are dynamically rendered here -->
                    </thead>
                    <tbody id="inventory-table-body">
                        <tr>
                            <td colspan="10" class="text-center text-muted">${__("Loading data...")}</td>
                        </tr>
                    </tbody>
                </table>
            `);
        }
        let filters = {

            company: company_filter.get_value(),
            warehouse: warehouse_filter.get_value(),
            item_group: item_group_filter.get_value(),
            from_date: from_date_filter.get_value(),
            to_date: to_date_filter.get_value(),
            tab: active_tab
        };
        
        frappe.call({
            method: "esoft_custom_bom.esoft_custom_bom.page.inventory_analytics.inventory_analytics.get_inventory_data",
            args: filters,
            callback: function(r) {
                if (r.message) {
                    if (should_update_from_date && r.message.last_transaction_date) {
                        is_updating_from_date = true;
                        from_date_filter.set_value(r.message.last_transaction_date);
                        is_updating_from_date = false;
                        should_update_from_date = false;
                    }
                    report_data = r.message.items;
                    update_kpis(r.message.kpis, r.message.currency);
                    sort_and_render();
                }
            }
        });
    }
    
    function strip_html(html_str) {
        if (!html_str) return "";
        if (typeof html_str === "string" && html_str.includes("<")) {
            return $("<span>" + html_str + "</span>").text().trim();
        }
        return html_str;
    }
    
    function format_currency(value, currency) {
        let formatted = frappe.format(value, {
            fieldtype: 'Currency',
            options: 'currency'
        }, {
            currency: currency
        });
        return strip_html(formatted);
    }
    
    // Dynamic KPI Grid Rendering
    function update_kpis(kpis, currency) {
        let kpi_container = $wrapper.find("#kpi-container");
        kpi_container.empty();
        
        if (active_tab === "valuation") {
            kpi_container.html(`
                <div class="kpi-card" id="kpi-total-val">
                    <div class="kpi-icon"><i class="fa fa-money text-success"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Total Valuation")}</span>
                        <h3 class="kpi-val">${format_currency(kpis.total_val, currency)}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-total-qty">
                    <div class="kpi-icon"><i class="fa fa-cubes text-info"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Total Stock Qty")}</span>
                        <h3 class="kpi-val">${frappe.format(kpis.total_qty, {fieldtype: 'Float'})}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-stocked-items">
                    <div class="kpi-icon"><i class="fa fa-check-circle text-teal"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Stocked Items")}</span>
                        <h3 class="kpi-val">${kpis.stocked_items}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-zero-stock">
                    <div class="kpi-icon"><i class="fa fa-exclamation-triangle text-danger"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Zero/Negative Items")}</span>
                        <h3 class="kpi-val">${kpis.zero_stock_items}</h3>
                    </div>
                </div>
            `);
        } 
        else if (active_tab === "slow_moving") {
            kpi_container.html(`
                <div class="kpi-card" id="kpi-slow-val">
                    <div class="kpi-icon"><i class="fa fa-clock-o text-warning"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Slow-Moving Value")}</span>
                        <h3 class="kpi-val">${format_currency(kpis.slow_moving_val, currency)}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-non-val">
                    <div class="kpi-icon"><i class="fa fa-ban text-danger"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Non-Moving Value")}</span>
                        <h3 class="kpi-val">${format_currency(kpis.non_moving_val, currency)}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-slow-items">
                    <div class="kpi-icon"><i class="fa fa-hourglass-2 text-warning"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Slow-Moving Items")}</span>
                        <h3 class="kpi-val">${kpis.slow_items_count}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-non-items">
                    <div class="kpi-icon"><i class="fa fa-calendar-times-o text-danger"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Non-Moving (Dead) Items")}</span>
                        <h3 class="kpi-val">${kpis.non_items_count}</h3>
                    </div>
                </div>
            `);
        } 
        else if (active_tab === "expiry") {
            kpi_container.html(`
                <div class="kpi-card" id="kpi-expired-val">
                    <div class="kpi-icon"><i class="fa fa-times-circle text-danger"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Expired Stock Value")}</span>
                        <h3 class="kpi-val">${format_currency(kpis.expired_val, currency)}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-near-val">
                    <div class="kpi-icon"><i class="fa fa-warning text-warning"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Near Expiry Value (<90d)")}</span>
                        <h3 class="kpi-val">${format_currency(kpis.near_expiry_val, currency)}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-safe-val">
                    <div class="kpi-icon"><i class="fa fa-shield text-success"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Safe Stock Value")}</span>
                        <h3 class="kpi-val">${format_currency(kpis.safe_val, currency)}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-total-batched">
                    <div class="kpi-icon"><i class="fa fa-archive text-info"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${__("Total Batched Qty")}</span>
                        <h3 class="kpi-val">${frappe.format(kpis.total_qty, {fieldtype: 'Float'})}</h3>
                    </div>
                </div>
            `);
        }
        else if (active_tab === "abc_analysis") {
            if (!kpis || !kpis.length) return;
            
            let total_item = kpis[0];
            let class_a = kpis[1];
            let class_b = kpis[2];
            let class_c = kpis[3];
            
            let total_val_str = total_item.datatype === "Currency" ? format_currency(total_item.value, currency) : frappe.format(total_item.value, {fieldtype: 'Float'});
            
            kpi_container.html(`
                <div class="kpi-card" id="kpi-abc-total">
                    <div class="kpi-icon"><i class="fa fa-calculator text-primary"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${total_item.label}</span>
                        <h3 class="kpi-val">${total_val_str}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-abc-a">
                    <div class="kpi-icon"><i class="fa fa-star text-success"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${class_a.label}</span>
                        <h3 class="kpi-val">${class_a.value}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-abc-b">
                    <div class="kpi-icon"><i class="fa fa-star-half-o text-warning"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${class_b.label}</span>
                        <h3 class="kpi-val">${class_b.value}</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-abc-c">
                    <div class="kpi-icon"><i class="fa fa-star-o text-danger"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${class_c.label}</span>
                        <h3 class="kpi-val">${class_c.value}</h3>
                    </div>
                </div>
            `);
        }
    }
    
    // Helper to render a Horizontal Segmented Bar & Grid Legend Section inside Widget 2
    function render_distribution_section(parent_container, section_title, data, group_field, metric_key, currency, is_status_group) {
        let group_data = {};
        
        data.forEach(row => {
            let grp_val = row[group_field] || __("Unspecified");
            let raw_val = flt(row[metric_key]);
            
            // For inactivity days or expiry days, sum up the Stock Value of the items falling in that group
            if (metric_key === "days_to_expiry" || metric_key === "days_inactive") {
                raw_val = flt(row["bal_val"]);
            }
            
            if (raw_val > 0) {
                group_data[grp_val] = (group_data[grp_val] || 0) + raw_val;
            }
        });
        
        let segments = Object.keys(group_data)
            .map(g => ({ raw_value: g, label: __(g), value: group_data[g] }))
            .sort((a, b) => b.value - a.value);
            
        if (segments.length === 0) {
            return; // Don't render empty sections
        }
        
        // Group into Others if more than 5 segments
        let final_segments = [];
        if (!is_status_group && segments.length > 5) {
            final_segments = segments.slice(0, 4);
            let others_val = segments.slice(4).reduce((sum, s) => sum + s.value, 0);
            final_segments.push({ raw_value: "Others", label: __("Others"), value: others_val });
        } else {
            final_segments = segments;
        }
        
        let total_val = final_segments.reduce((sum, s) => sum + s.value, 0);
        
        // Colors palette mapping
        let palette = ["#3182ce", "#4c51bf", "#805ad5", "#d53f8c", "#319795", "#718096"];
        if (is_status_group) {
            final_segments.forEach(s => {
                if (s.raw_value === "Expired" || s.raw_value === "Non-Moving" || s.raw_value.includes("< 30") || s.raw_value === "C") {
                    s.color = "#e53e3e"; // Red / Class C
                } else if (s.raw_value === "Slow-Moving" || s.raw_value.includes("< 90") || s.raw_value === "B") {
                    s.color = "#dd6b20"; // Orange / Class B
                } else if (s.raw_value === "Active" || s.raw_value === "Safe" || s.raw_value === "A") {
                    s.color = "#38a169"; // Green / Class A
                } else {
                    s.color = "#3182ce"; // Blue
                }
            });
        } else {
            final_segments.forEach((s, idx) => {
                s.color = palette[idx % palette.length];
            });
        }
        
        // Format and compute percentage
        final_segments.forEach(s => {
            let percentage = total_val > 0 ? (s.value / total_val) * 100 : 0;
            let formatted_segment_val = "";
            let is_qty_metric = ["qty", "bal_qty", "opening_qty", "in_qty", "out_qty"].includes(metric_key);
            let is_qty_based = (abc_based_on_filter ? abc_based_on_filter.get_value() : "Stock Value").includes("Quantity");

            if (active_tab === "abc_analysis") {
                if (is_qty_based) {
                    formatted_segment_val = frappe.format(s.value, {fieldtype: 'Float'});
                } else {
                    formatted_segment_val = format_currency(s.value, currency);
                }
            } else if (active_tab === "valuation" && !is_qty_metric) {
                formatted_segment_val = format_currency(s.value, currency);
            } else if (metric_key === "bal_val" || (active_tab === "slow_moving" && (metric_key === "days_inactive" || metric_key === "bal_val"))) {
                formatted_segment_val = format_currency(s.value, currency);
            } else {
                formatted_segment_val = frappe.format(s.value, {fieldtype: 'Float'});
            }
            s.formatted_val = formatted_segment_val;
            s.percentage = percentage;
        });

        // Build HTML
        let bar_segments_html = "";
        final_segments.forEach((s, idx) => {
            if (s.value > 0) {
                let display_label = s.label;
                if (s.raw_value === "Active") display_label = __("Fast-Moving (Active)");
                else if (s.raw_value === "Non-Moving") display_label = __("Non-Moving (Dead)");

                bar_segments_html += `
                    <div class="bar-segment" 
                         style="background-color: ${s.color}; flex: ${s.percentage} 1 auto; min-width: 6px;" 
                         data-group="${group_field}"
                         data-index="${idx}" 
                         title="${display_label}: ${s.formatted_val} (${s.percentage.toFixed(1)}%)">
                    </div>
                `;
            }
        });

        let section_id = `dist-section-${group_field}`;
        let section_html = $(`
            <div class="distribution-section" id="${section_id}">
                <div class="distribution-section-title">${section_title}</div>
                <div class="distribution-bar-wrapper">
                    <div class="distribution-bar">
                        ${bar_segments_html}
                    </div>
                </div>
                <div class="distribution-legend">
                    <!-- Cards added dynamically -->
                </div>
            </div>
        `);
        
        parent_container.append(section_html);
        
        let legend_container = section_html.find(".distribution-legend");
        final_segments.forEach((s, idx) => {
            let display_label = s.label;
            if (s.raw_value === "Active") display_label = __("Fast-Moving (Active)");
            else if (s.raw_value === "Non-Moving") display_label = __("Non-Moving (Dead)");
            
            let is_active_filter = local_sub_filter && local_sub_filter.value === s.raw_value;
            
            let legend_card = $(`
                <div class="legend-item ${is_active_filter ? 'active-legend' : ''}" data-group="${group_field}" data-index="${idx}">
                    <span class="legend-color" style="background-color: ${s.color}"></span>
                    <div class="legend-info">
                        <div class="legend-label-row">
                            <span class="legend-label" title="${display_label}">${display_label}</span>
                            <span class="legend-percentage">${s.percentage.toFixed(1)}%</span>
                        </div>
                        <span class="legend-value">${s.formatted_val}</span>
                    </div>
                </div>
            `);
            
            // Hover synchronization: Hovering on card highlights matching bar segment
            legend_card.on("mouseenter", function() {
                section_html.find(`.bar-segment[data-index="${idx}"]`).css({
                    "filter": "brightness(1.15)",
                    "transform": "scaleY(1.1)"
                });
            }).on("mouseleave", function() {
                section_html.find(`.bar-segment[data-index="${idx}"]`).css({
                    "filter": "",
                    "transform": ""
                });
            });
            
            // Click to filter table locally
            legend_card.on("click", function() {
                if (local_sub_filter && local_sub_filter.value === s.raw_value) {
                    local_sub_filter = null;
                } else {
                    local_sub_filter = {
                        key: group_field,
                        value: s.raw_value
                    };
                }
                sort_and_render();
            });
            
            legend_container.append(legend_card);
        });

        // Hover synchronization: Hovering on bar segment highlights matching card
        section_html.find(".bar-segment").on("mouseenter", function() {
            let idx = $(this).attr("data-index");
            section_html.find(`.legend-item[data-index="${idx}"]`).css({
                "border-color": "#3182ce",
                "box-shadow": "0 4px 6px rgba(0, 0, 0, 0.05)",
                "background-color": "#f7fafc"
            });
        }).on("mouseleave", function() {
            let idx = $(this).attr("data-index");
            let card = section_html.find(`.legend-item[data-index="${idx}"]`);
            if (!card.hasClass("active-legend")) {
                card.css({
                    "border-color": "",
                    "box-shadow": "",
                    "background-color": ""
                });
            }
        });

        // Click on bar segment filters the table
        section_html.find(".bar-segment").on("click", function() {
            let idx = $(this).attr("data-index");
            let s = final_segments[idx];
            if (local_sub_filter && local_sub_filter.value === s.raw_value) {
                local_sub_filter = null;
            } else {
                local_sub_filter = {
                    key: group_field,
                    value: s.raw_value
                };
            }
            sort_and_render();
        });
    }

    // Dynamic Premium Widgets (Ranking List & Distribution Overviews)
    function render_custom_widgets(display_data, currency) {
        let metric = get_active_metric_details();
        let key = metric.key;
        let is_currency = metric.is_currency;
        
        // --- 1. RENDER WIDGET 1: DYNAMIC METRIC RANKING LIST ---
        let ranking_title = $wrapper.find("#widget-ranking-title");
        let ranking_container = $wrapper.find("#widget-ranking-content");
        let donut_container = $wrapper.find("#widget-donut-content");
        
        ranking_container.attr("style", "");
        donut_container.attr("style", "");
        
        ranking_title.html(`${__("Top Items by")} <strong>${metric.label}</strong>`);
        ranking_container.empty();
        
        if (display_data.length === 0) {
            ranking_container.html(`<div class="text-center text-muted py-5">${__("No ranking data available")}</div>`);
        } else {
            // Sort items for ranking. Expiring items: soonest first (ascending). Valuation/Inactivity: highest first (descending).
            let sort_asc = (active_tab === "expiry" && key === "days_to_expiry");
            let sorted_items = display_data.slice()
                .filter(row => {
                    // Filter out zero/negative values for clean ranking lists (except for days inactive/days to expiry)
                    if (key === "days_inactive" || key === "days_to_expiry") return true;
                    return flt(row[key]) > 0;
                })
                .sort((a, b) => {
                    return sort_asc ? flt(a[key]) - flt(b[key]) : flt(b[key]) - flt(a[key]);
                })
                .slice(0, 5);
            
            if (sorted_items.length === 0) {
                ranking_container.html(`<div class="text-center text-muted py-5">${__("No non-zero data matches criteria")}</div>`);
            } else {
                let reference_val = flt(sorted_items[0][key]);
                // If reference is 0, default to 1 to avoid division by zero
                if (reference_val === 0) reference_val = 1;
                
                let colors = ["#319795", "#3182ce", "#4c51bf", "#805ad5", "#d53f8c"];
                if (active_tab === "slow_moving") colors = ["#dd6b20", "#ed8936", "#f6ad55", "#4a5568", "#718096"];
                if (active_tab === "expiry") colors = ["#e53e3e", "#e53e3e", "#dd6b20", "#ecc94b", "#38a169"];
                if (active_tab === "abc_analysis") colors = ["#38a169", "#dd6b20", "#e53e3e", "#3182ce", "#805ad5"];
                
                sorted_items.forEach((item, idx) => {
                    let raw_val = flt(item[key]);
                    let formatted_val = "";
                    
                    if (key === "days_inactive" || key === "days_to_expiry") {
                        formatted_val = `${raw_val} ${__("days")}`;
                        if (raw_val === 9999) formatted_val = __("Never");
                    } else if (is_currency) {
                        formatted_val = format_currency(raw_val, item.currency);
                    } else {
                        formatted_val = frappe.format(raw_val, {fieldtype: 'Float'});
                    }
                    
                    // Progress percentage calculation
                    let pct = 0;
                    if (sort_asc) {
                        // Soonest expiry = 100% bar. Longest expiry = lower bar.
                        let max_expiry = flt(sorted_items[sorted_items.length - 1][key]);
                        pct = max_expiry > 0 ? (1 - (raw_val / max_expiry)) * 80 + 20 : 100;
                    } else {
                        pct = (raw_val / reference_val) * 100;
                    }
                    if (pct < 5) pct = 5; // Minimum progress bar representation
                    if (pct > 100) pct = 100;
                    
                    let secondary_label = item.item_name || "";
                    if (active_tab === "expiry" && item.batch_no) {
                        secondary_label = `${secondary_label} (${__("Batch:")} ${item.batch_no})`;
                    }
                    
                    let card = $(`
                        <div class="ranking-item" data-code="${item.item_code}" data-batch="${item.batch_no || ''}">
                            <div class="ranking-header-row">
                                <span class="ranking-rank" style="color: ${colors[idx]}">#${idx + 1}</span>
                                <span class="ranking-code">${item.item_code}</span>
                                <span class="ranking-value font-weight-bold">${formatted_val}</span>
                            </div>
                            <div class="ranking-name text-muted">${secondary_label}</div>
                            <div class="ranking-bar-bg">
                                <div class="ranking-bar" data-width="${pct}" style="width: 0%; background: ${colors[idx]};"></div>
                            </div>
                        </div>
                    `);
                    ranking_container.append(card);
                });
                
                // Animate ranking progress bars
                setTimeout(() => {
                    $wrapper.find(".ranking-bar").each(function() {
                        let w = $(this).attr("data-width");
                        $(this).css("width", w + "%");
                    });
                }, 100);
            }
        }
        
        // Click on Ranking Item redirects directly to form
        $wrapper.off("click", ".ranking-item").on("click", ".ranking-item", function() {
            let code = $(this).attr("data-code");
            let batch = $(this).attr("data-batch");
            
            if (active_tab === "expiry" && batch) {
                frappe.set_route("Form", "Batch", batch);
            } else {
                frappe.set_route("Form", "Item", code);
            }
        });
        
        // --- 2. RENDER WIDGET 2: DUAL DISTRIBUTION OVERVIEWS ---
        let donut_title = $wrapper.find("#widget-donut-title");
        donut_container = $wrapper.find("#widget-donut-content");
        
        donut_container.empty();
        donut_title.html(`${__("Distribution Overviews")}`);
        
        // Define data subsets for distribution
        let search_text = $wrapper.find("#item-search-input").val().toLowerCase();
        let active_data = [];
        if (active_tab === "slow_moving") {
            active_data = report_data.filter(row => {
                let matches_search = (
                    row.item_code.toLowerCase().includes(search_text) ||
                    (row.item_name && row.item_name.toLowerCase().includes(search_text)) ||
                    (row.item_group && row.item_group.toLowerCase().includes(search_text)) ||
                    (row.warehouse && row.warehouse.toLowerCase().includes(search_text))
                );
                return matches_search && row.bal_qty > 0;
            });
        } else {
            active_data = display_data;
        }

        // Render first section (Primary) and second section (Secondary)
        if (active_tab === "valuation") {
            let title = `${__("Warehouse Split by")} <strong>${metric.label}</strong>`;
            render_distribution_section(donut_container, title, active_data, "warehouse", key, currency, false);
            
            let title2 = `${__("Item Group Split by")} <strong>${metric.label}</strong>`;
            render_distribution_section(donut_container, title2, active_data, "item_group", key, currency, false);
        } 
        else if (active_tab === "slow_moving") {
            let metric_label = (key === "days_inactive") ? __("Stock Value") : metric.label;
            let title = `${__("Stock Activity Proportions by")} <strong>${metric_label}</strong>`;
            render_distribution_section(donut_container, title, active_data, "status", key, currency, true);
            
            // Only group slow/non-moving items for the secondary item group split
            let slow_non_moving_data = active_data.filter(row => row.days_inactive > 30);
            let title2 = `${__("Slow-Moving Item Groups by")} <strong>${metric_label}</strong>`;
            render_distribution_section(donut_container, title2, slow_non_moving_data, "item_group", key, currency, false);
        } 
        else if (active_tab === "expiry") {
            let title = `${__("Expiry Risk Split by")} <strong>${metric.label}</strong>`;
            render_distribution_section(donut_container, title, active_data, "status", key, currency, true);
            
            let title2 = `${__("Item Group Expiry Value Split")}`;
            render_distribution_section(donut_container, title2, active_data, "item_group", key, currency, false);
        }
        else if (active_tab === "abc_analysis") {
            let title = `${__("ABC Classification Distribution by")} <strong>${metric.label}</strong>`;
            render_distribution_section(donut_container, title, active_data, "abc_class", key, currency, true);
            
            let title2 = `${__("Item Group Classification Split")}`;
            render_distribution_section(donut_container, title2, active_data, "item_group", key, currency, false);
        }
    }
    
    // Sort and Local Search Filter (scoped to $wrapper)
    function sort_and_render() {
        current_page = 1;
        let search_text = $wrapper.find("#item-search-input").val().toLowerCase();
        
        // Filter based on search query
        let display_data = report_data.filter(row => {
            return (
                row.item_code.toLowerCase().includes(search_text) ||
                (row.item_name && row.item_name.toLowerCase().includes(search_text)) ||
                (row.item_group && row.item_group.toLowerCase().includes(search_text)) ||
                (row.warehouse && row.warehouse.toLowerCase().includes(search_text))
            );
        });
        
        // Filter based on local chart sub-filters (Warehouse click, Inactivity slice click)
        if (local_sub_filter) {
            display_data = display_data.filter(row => {
                return row[local_sub_filter.key] === local_sub_filter.value;
            });
            
            // Render sub-filter removal badge
            let label_val = local_sub_filter.value;
            if (label_val === "Active") label_val = __("Fast-Moving (Active)");
            else if (label_val === "Non-Moving") label_val = __("Non-Moving (Dead)");
            let badge_text = "";
            if (local_sub_filter.key === "warehouse") {
                badge_text = `${__("Warehouse:")} ${local_sub_filter.value}`;
            } else if (local_sub_filter.key === "item_group") {
                badge_text = `${__("Item Group:")} ${local_sub_filter.value}`;
            } else if (local_sub_filter.key === "material_request_type") {
                badge_text = `${__("Purpose:")} ${local_sub_filter.value}`;
            } else if (local_sub_filter.key === "item_code") {
                badge_text = `${__("Item:")} ${local_sub_filter.value}`;
            } else {
                badge_text = `${__("Status:")} ${label_val}`;
            }
            
            $wrapper.find("#table-filter-info").html(`
                <span class="sub-filter-badge">
                    ${badge_text} <i class="fa fa-times remove-filter-btn"></i>
                </span>
            `);
            $wrapper.find(".remove-filter-btn").on("click", function() {
                local_sub_filter = null;
                $wrapper.find("#table-filter-info").empty();
                sort_and_render();
                if (active_tab === "fulfillment" && raw_fulfillment_data) {
                    render_fulfillment_tab(raw_fulfillment_data);
                }
            });
        } else {
            $wrapper.find("#table-filter-info").empty();
            // Apply default tab filtering if no local sub-filter is active
            if (active_tab === "slow_moving") {
                display_data = display_data.filter(row => row.days_inactive > 30 && row.bal_qty > 0);
            }
        }
        
        // Apply sorting
        let key = current_sort.key;
        let is_asc = current_sort.asc;
        
        display_data.sort((a, b) => {
            let valA = a[key];
            let valB = b[key];
            
            if (valA === null || valA === undefined) valA = (is_asc ? 999999 : -999999);
            if (valB === null || valB === undefined) valB = (is_asc ? 999999 : -999999);
            
            let isStringA = typeof valA === "string";
            let isStringB = typeof valB === "string";
            
            if (isStringA && isStringB) {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            } else {
                valA = flt(valA);
                valB = flt(valB);
            }
            
            if (valA < valB) return is_asc ? -1 : 1;
            if (valA > valB) return is_asc ? 1 : -1;
            return 0;
        });
        
        filtered_table_data = display_data;
        render_table_headers();
        render_table_body(display_data);
        
        // Re-render custom progress bar ranking list and circular donut charts dynamically matching sorting
        if (active_tab !== "fulfillment") {
            render_custom_widgets(display_data, report_data.length ? report_data[0].currency : null);
        }
    }
    
    // Dynamic Table Headers with Click-to-Sort Indicators (scoped to $wrapper)
    function render_table_headers() {
        let thead = $wrapper.find("#inventory-table-head");
        thead.empty();
        
        let headers = [];
        if (active_tab === "valuation") {
            headers = [
                { key: "item_code", label: __("Item Code") },
                { key: "item_name", label: __("Item Name") },
                { key: "item_group", label: __("Item Group") },
                { key: "warehouse", label: __("Warehouse") },
                { key: "opening_qty", label: __("Opening Qty"), align: "right" },
                { key: "in_qty", label: __("In Qty"), align: "right" },
                { key: "out_qty", label: __("Out Qty"), align: "right" },
                { key: "bal_qty", label: __("Balance Qty"), align: "right" },
                { key: "val_rate", label: __("Val. Rate"), align: "right" },
                { key: "bal_val", label: __("Stock Value"), align: "right" }
            ];
        } else if (active_tab === "fulfillment") {
            headers = [
                { key: "mr_no", label: __("MR No.") },
                { key: "mr_date", label: __("Date") },
                { key: "material_request_type", label: __("Type") },
                { key: "item_code", label: __("Item Code") },
                { key: "item_name", label: __("Item Name") },
                { key: "target_warehouse", label: __("Target Wh") },
                { key: "required_date", label: __("Required By") },
                { key: "days_overdue", label: __("Days Overdue"), align: "right" },
                { key: "pending_qty", label: __("Pending Qty"), align: "right" },
                { key: "status", label: __("Status") }
            ];
        } 
        else if (active_tab === "slow_moving") {
            headers = [
                { key: "item_code", label: __("Item Code") },
                { key: "item_name", label: __("Item Name") },
                { key: "warehouse", label: __("Warehouse") },
                { key: "bal_qty", label: __("Qty"), align: "right" },
                { key: "val_rate", label: __("Rate"), align: "right" },
                { key: "bal_val", label: __("Stock Value"), align: "right" },
                { key: "last_date", label: __("Last Ledger Transaction") },
                { key: "days_inactive", label: __("Days Inactive"), align: "right" },
                { key: "status", label: __("Status") }
            ];
        } 
        else if (active_tab === "expiry") {
            headers = [
                { key: "item_code", label: __("Item Code") },
                { key: "item_name", label: __("Item Name") },
                { key: "warehouse", label: __("Warehouse") },
                { key: "batch_no", label: __("Batch No") },
                { key: "expiry_date", label: __("Expiry Date") },
                { key: "days_to_expiry", label: __("Days to Expiry"), align: "right" },
                { key: "bal_qty", label: __("Batch Qty"), align: "right" },
                { key: "val_rate", label: __("Rate"), align: "right" },
                { key: "bal_val", label: __("Batch Value"), align: "right" },
                { key: "status", label: __("Risk Status") }
            ];
        }
        else if (active_tab === "abc_analysis") {
            let based_on = abc_based_on_filter ? abc_based_on_filter.get_value() : "Stock Value";
            let qty_lbl = __("Qty");
            let val_lbl = __("Value");
            let val_pct_lbl = __("Value %");
            let cum_lbl = __("Cumulative Value");
            let cum_pct_lbl = __("Cumulative Value %");

            if (based_on === "Stock Quantity") {
                qty_lbl = __("Stock Qty");
                val_lbl = __("Stock Value");
                val_pct_lbl = __("Qty %");
                cum_lbl = __("Cumulative Qty");
                cum_pct_lbl = __("Cumulative Qty %");
            } else if (based_on === "Consumption Value") {
                qty_lbl = __("Consumption Qty");
                val_lbl = __("Consumption Value");
            } else if (based_on === "Consumption Quantity") {
                qty_lbl = __("Consumption Qty");
                val_lbl = __("Consumption Value");
                val_pct_lbl = __("Qty %");
                cum_lbl = __("Cumulative Qty");
                cum_pct_lbl = __("Cumulative Qty %");
            } else if (based_on === "Sales Value") {
                qty_lbl = __("Sales Qty");
                val_lbl = __("Sales Value");
            } else if (based_on === "Sales Quantity") {
                qty_lbl = __("Sales Qty");
                val_lbl = __("Sales Value");
                val_pct_lbl = __("Qty %");
                cum_lbl = __("Cumulative Qty");
                cum_pct_lbl = __("Cumulative Qty %");
            } else {
                qty_lbl = __("Stock Qty");
                val_lbl = __("Stock Value");
            }

            headers = [
                { key: "item_code", label: __("Item Code") },
                { key: "item_name", label: __("Item Name") },
                { key: "item_group", label: __("Item Group") },
                { key: "stock_uom", label: __("UOM") },
                { key: "qty", label: qty_lbl, align: "right" },
                { key: "rate", label: __("Avg Rate"), align: "right" },
                { key: "value", label: val_lbl, align: "right" },
                { key: "value_percent", label: val_pct_lbl, align: "right" },
                { key: "cumulative_value", label: cum_lbl, align: "right" },
                { key: "cumulative_percent", label: cum_pct_lbl, align: "right" },
                { key: "abc_class", label: __("ABC Class"), align: "center" }
            ];
        }
        
        let tr = $("<tr></tr>");
        headers.forEach(h => {
            let sort_icon = "";
            if (current_sort.key === h.key) {
                sort_icon = current_sort.asc ? ' <i class="fa fa-sort-asc active-sort"></i>' : ' <i class="fa fa-sort-desc active-sort"></i>';
            } else {
                sort_icon = ' <i class="fa fa-sort text-muted"></i>';
            }
            
            let th = $(`
                <th class="${h.align === 'right' ? 'text-right' : ''}" 
                    data-sort="${h.key}" 
                    title="${__("Click to sort by ")}${h.label}">
                    ${h.label}${sort_icon}
                </th>
            `);
            
            th.on("click", function() {
                let sort_key = $(this).attr("data-sort");
                if (current_sort.key === sort_key) {
                    current_sort.asc = !current_sort.asc;
                } else {
                    current_sort.key = sort_key;
                    current_sort.asc = true;
                }
                
                // Programmatically update the Sort By dropdown select filter on top
                updating_sort_dropdown = true;
                let new_val = "";
                if (active_tab === "valuation") {
                    if (current_sort.key === "bal_val") {
                        new_val = current_sort.asc ? __("Stock Value (Low to High)") : __("Stock Value (High to Low)");
                    } else if (current_sort.key === "bal_qty") {
                        new_val = current_sort.asc ? __("Balance Qty (Low to High)") : __("Balance Qty (High to Low)");
                    } else if (current_sort.key === "item_code") {
                        new_val = current_sort.asc ? __("Item Code (A-Z)") : __("Item Code (Z-A)");
                    }
                } 
                else if (active_tab === "slow_moving") {
                    if (current_sort.key === "days_inactive") {
                        new_val = current_sort.asc ? __("Inactivity Days (Low to High)") : __("Inactivity Days (High to Low)");
                    } else if (current_sort.key === "bal_val") {
                        new_val = __("Stock Value (High to Low)");
                    } else if (current_sort.key === "bal_qty") {
                        new_val = __("Balance Qty (High to Low)");
                    }
                } 
                else if (active_tab === "expiry") {
                    if (current_sort.key === "days_to_expiry") {
                        new_val = current_sort.asc ? __("Days to Expiry (Soonest first)") : __("Days to Expiry (Latest first)");
                    } else if (current_sort.key === "bal_val") {
                        new_val = __("Batch Value (High to Low)");
                    } else if (current_sort.key === "bal_qty") {
                        new_val = __("Batch Qty (High to Low)");
                    }
                }
                
                if (new_val) {
                    sort_filter.set_value(new_val);
                }
                updating_sort_dropdown = false;
                
                sort_and_render();
            });
            tr.append(th);
        });
        thead.append(tr);
    }
    
    // Dynamic Table Body Rendering (scoped to $wrapper)
    function render_table_body(data) {
        let tbody = $wrapper.find("#inventory-table-body");
        tbody.empty();
        
        let start = (current_page - 1) * page_size;
        let end = start + page_size;
        let paginated_data = data.slice(start, end);
        let total_count = data.length;
        
        let showing_start = total_count > 0 ? start + 1 : 0;
        let showing_end = Math.min(end, total_count);
        $wrapper.find("#results-count").text(`Showing ${showing_start} to ${showing_end} of ${total_count} items`);
        
        if (total_count === 0) {
            let col_span = active_tab === "valuation" ? 10 : (active_tab === "slow_moving" ? 9 : (active_tab === "fulfillment" || active_tab === "abc_analysis" ? 11 : 10));
            tbody.append(`<tr><td colspan="${col_span}" class="text-center text-muted">No data matching your criteria.</td></tr>`);
            
            // Clean up pagination area if empty
            let container = $wrapper.find(".table-container");
            container.find(".pagination-area").remove();
            return;
        }
        
        paginated_data.forEach(row => {
            let tr = $("<tr></tr>");
            
            if (active_tab === "valuation") {
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${row.item_code}')">${row.item_code}</a></td>`);
                tr.append(`<td>${row.item_name || ""}</td>`);
                tr.append(`<td>${row.item_group || ""}</td>`);
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Warehouse', '${row.warehouse}')">${row.warehouse}</a></td>`);
                tr.append(`<td class="text-right text-muted">${frappe.format(row.opening_qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right text-success">+${frappe.format(row.in_qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right text-danger">-${frappe.format(row.out_qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right font-weight-bold">${frappe.format(row.bal_qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right">${format_currency(row.val_rate, row.currency)}</td>`);
                tr.append(`<td class="text-right font-weight-bold">${format_currency(row.bal_val, row.currency)}</td>`);
            } 
            else if (active_tab === "slow_moving") {
                let badge_class = row.status === "Non-Moving" ? "badge-danger" : "badge-warning";
                
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${row.item_code}')">${row.item_code}</a></td>`);
                tr.append(`<td>${row.item_name || ""}</td>`);
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Warehouse', '${row.warehouse}')">${row.warehouse}</a></td>`);
                tr.append(`<td class="text-right">${frappe.format(row.bal_qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right">${format_currency(row.val_rate, row.currency)}</td>`);
                tr.append(`<td class="text-right font-weight-bold">${format_currency(row.bal_val, row.currency)}</td>`);
                tr.append(`<td>${frappe.datetime.str_to_user(row.last_date) || ""}</td>`);
                tr.append(`<td class="text-right font-weight-bold text-danger">${row.days_inactive} ${__("days")}</td>`);
                tr.append(`<td><span class="badge ${badge_class}">${__(row.status)}</span></td>`);
            } 
            else if (active_tab === "fulfillment") {
                let badge_class = "badge-danger";
                if (row.status === "Fulfilled") badge_class = "badge-success";
                else if (row.status === "Partial") badge_class = "badge-warning";
                
                let overdue_cell = "-";
                if (row.is_overdue && row.days_overdue > 0) {
                    overdue_cell = `<span class="text-danger font-weight-bold">${row.days_overdue} ${__("days")}</span>`;
                }

                let pct_color = row.pct_fulfilled >= 100 ? "text-success" : (row.pct_fulfilled > 0 ? "text-warning" : "text-muted");
                let status_html = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="badge ${badge_class}">${__(row.status)}</span>
                        <span class="${pct_color} font-weight-bold" style="font-size: 11px;">${row.pct_fulfilled}%</span>
                    </div>
                `;

                let pending_class = row.pending_qty > 0 ? "text-danger font-weight-bold" : "";
                
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Material Request', '${row.mr_no}')">${row.mr_no}</a></td>`);
                tr.append(`<td>${frappe.datetime.str_to_user(row.mr_date) || ""}</td>`);
                tr.append(`<td>${row.material_request_type || ""}</td>`);
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${row.item_code}')">${row.item_code}</a></td>`);
                tr.append(`<td>${row.item_name || ""}</td>`);
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Warehouse', '${row.target_warehouse}')">${row.target_warehouse || ""}</a></td>`);
                tr.append(`<td>${frappe.datetime.str_to_user(row.required_date) || "-"}</td>`);
                tr.append(`<td class="text-right">${overdue_cell}</td>`);
                tr.append(`<td class="text-right ${pending_class}">${frappe.format(row.pending_qty, {fieldtype: 'Float'})} <small class="text-muted">${row.stock_uom || ""}</small></td>`);
                tr.append(`<td>${status_html}</td>`);
            } 
            else if (active_tab === "expiry") {
                let badge_class = "badge-success";
                let status_str = row.status || "";
                if (status_str === "Expired") badge_class = "badge-danger";
                else if (status_str.includes("< 30")) badge_class = "badge-danger";
                else if (status_str.includes("< 90")) badge_class = "badge-warning";
                
                let days_to_expiry_text = row.days_to_expiry === 9999 ? __("Never") : `${row.days_to_expiry} ${__("days")}`;
                let days_class = row.days_to_expiry < 0 ? "text-danger font-weight-bold" : (row.days_to_expiry <= 90 ? "text-warning font-weight-bold" : "");
                
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${row.item_code}')">${row.item_code}</a></td>`);
                tr.append(`<td>${row.item_name || ""}</td>`);
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Warehouse', '${row.warehouse}')">${row.warehouse}</a></td>`);
                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Batch', '${row.batch_no}')">${row.batch_no}</a></td>`);
                tr.append(`<td>${frappe.datetime.str_to_user(row.expiry_date) || __("No Expiry")}</td>`);
                tr.append(`<td class="text-right ${days_class}">${days_to_expiry_text}</td>`);
                tr.append(`<td class="text-right">${frappe.format(row.bal_qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right">${format_currency(row.val_rate, row.currency)}</td>`);
                tr.append(`<td class="text-right font-weight-bold">${format_currency(row.bal_val, row.currency)}</td>`);
                tr.append(`<td><span class="badge ${badge_class}">${__(row.status)}</span></td>`);
            }
            else if (active_tab === "abc_analysis") {
                let badge_class = "badge-success";
                if (row.abc_class === "B") badge_class = "badge-warning";
                else if (row.abc_class === "C") badge_class = "badge-danger";

                let comp = company_filter.get_value();
                let cur = row.currency || (comp ? frappe.get_cached_value("Company", comp, "default_currency") : null) || "USD";

                tr.append(`<td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${row.item_code}')">${row.item_code}</a></td>`);
                tr.append(`<td>${row.item_name || ""}</td>`);
                tr.append(`<td>${row.item_group || ""}</td>`);
                tr.append(`<td>${row.stock_uom || ""}</td>`);
                tr.append(`<td class="text-right">${frappe.format(row.qty, {fieldtype: 'Float'})}</td>`);
                tr.append(`<td class="text-right">${format_currency(row.rate, cur)}</td>`);
                tr.append(`<td class="text-right font-weight-bold">${format_currency(row.value, cur)}</td>`);
                tr.append(`<td class="text-right">${frappe.format(row.value_percent, {fieldtype: 'Percent'})}%</td>`);
                
                let is_qty_based = (abc_based_on_filter ? abc_based_on_filter.get_value() : "Stock Value").includes("Quantity");
                let cum_val_str = is_qty_based ? frappe.format(row.cumulative_value, {fieldtype: 'Float'}) : format_currency(row.cumulative_value, cur);
                
                tr.append(`<td class="text-right">${cum_val_str}</td>`);
                tr.append(`<td class="text-right">${frappe.format(row.cumulative_percent, {fieldtype: 'Percent'})}%</td>`);
                tr.append(`<td class="text-center"><span class="badge ${badge_class}">${row.abc_class}</span></td>`);
            }
            
            tbody.append(tr);
        });
        
        render_pagination(total_count);
    }
    
    // Render pagination controls (scoped to $wrapper)
    function render_pagination(total_items) {
        let container = $wrapper.find(".table-container");
        let pagination_area = container.find(".pagination-area");
        if (!pagination_area.length) {
            container.append(`
                <div class="pagination-area" style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding: 10px 0; border-top: 1px solid var(--border-color, #e2e8f0); flex-wrap: wrap; gap: 10px;">
                </div>
            `);
            pagination_area = container.find(".pagination-area");
        }
        
        pagination_area.empty();
        
        if (total_items === 0) {
            return;
        }
        
        let total_pages = Math.ceil(total_items / page_size);
        
        // 1. Page Size Selector
        let size_selector = $(`
            <div class="page-size-selector" style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 13px; color: var(--text-muted, #718096);">${__("Show")}</span>
                <select class="form-control page-size-select" style="width: auto; height: 30px; padding: 2px 8px; font-size: 13px; display: inline-block;">
                    <option value="10" ${page_size === 10 ? 'selected' : ''}>10</option>
                    <option value="20" ${page_size === 20 ? 'selected' : ''}>20</option>
                    <option value="50" ${page_size === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${page_size === 100 ? 'selected' : ''}>100</option>
                </select>
                <span style="font-size: 13px; color: var(--text-muted, #718096);">${__("entries")}</span>
            </div>
        `);
        
        size_selector.find(".page-size-select").on("change", function() {
            page_size = parseInt($(this).val());
            current_page = 1;
            render_table_body(filtered_table_data);
        });
        
        pagination_area.append(size_selector);
        
        // 2. Pagination Buttons
        let buttons_container = $('<div class="pagination-buttons" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;"></div>');
        
        // Helper to add button
        function add_button(label, page_num, active = false, disabled = false) {
            let btn = $(`
                <button class="btn btn-default btn-xs pagination-btn ${active ? 'btn-primary active' : ''}" 
                    style="min-width: 28px; height: 28px; padding: 0 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; border-radius: 4px; cursor: ${disabled ? 'not-allowed' : 'pointer'};" 
                    ${disabled ? 'disabled' : ''}>
                    ${label}
                </button>
            `);
            if (!disabled && !active) {
                btn.on("click", function() {
                    current_page = page_num;
                    render_table_body(filtered_table_data);
                });
            }
            buttons_container.append(btn);
        }
        
        // Previous Button
        add_button('<i class="fa fa-angle-left"></i>', current_page - 1, false, current_page === 1);
        
        // Page numbers logic (sliding window)
        let max_visible_pages = 5;
        let start_page = Math.max(1, current_page - Math.floor(max_visible_pages / 2));
        let end_page = Math.min(total_pages, start_page + max_visible_pages - 1);
        
        if (end_page - start_page + 1 < max_visible_pages) {
            start_page = Math.max(1, end_page - max_visible_pages + 1);
        }
        
        if (start_page > 1) {
            add_button('1', 1);
            if (start_page > 2) {
                buttons_container.append('<span style="padding: 0 4px; color: var(--text-muted, #718096);">...</span>');
            }
        }
        
        for (let i = start_page; i <= end_page; i++) {
            add_button(i.toString(), i, i === current_page);
        }
        
        if (end_page < total_pages) {
            if (end_page < total_pages - 1) {
                buttons_container.append('<span style="padding: 0 4px; color: var(--text-muted, #718096);">...</span>');
            }
            add_button(total_pages.toString(), total_pages);
        }
        
        // Next Button
        add_button('<i class="fa fa-angle-right"></i>', current_page + 1, false, current_page === total_pages);
        
        pagination_area.append(buttons_container);
    }
    
    // Client-side CSV Export Engine
    function export_to_csv() {
        if (filtered_table_data.length === 0) {
            frappe.show_alert({message: __("No stock data to export"), indicator: "orange"});
            return;
        }
        
        let headers = [];
        let row_mapper = null;
        let filename = `inventory_${active_tab}_${frappe.datetime.get_today()}.csv`;
        
        if (active_tab === "valuation") {
            headers = ["Item Code", "Item Name", "Item Group", "Warehouse", "Opening Qty", "In Qty", "Out Qty", "Balance Qty", "Valuation Rate", "Stock Value"];
            row_mapper = (r) => [r.item_code, r.item_name || "", r.item_group || "", r.warehouse, r.opening_qty, r.in_qty, r.out_qty, r.bal_qty, r.val_rate, r.bal_val];
        } else if (active_tab === "fulfillment") {
            headers = ["MR No", "Date", "Type", "Item Code", "Item Name", "Target Warehouse", "Required By", "Days Overdue", "Pending Qty", "Status"];
            row_mapper = (r) => [r.mr_no, r.mr_date || "", r.material_request_type || "", r.item_code, r.item_name || "", r.target_warehouse || "", r.required_date || "", r.days_overdue || 0, r.pending_qty, `${r.status} (${r.pct_fulfilled}%)`];
        } 
        else if (active_tab === "slow_moving") {
            headers = ["Item Code", "Item Name", "Warehouse", "Qty", "Rate", "Stock Value", "Last Ledger Date", "Days Inactive", "Status"];
            row_mapper = (r) => [r.item_code, r.item_name || "", r.warehouse, r.bal_qty, r.val_rate, r.bal_val, r.last_date || "", r.days_inactive, r.status];
        } 
        else if (active_tab === "expiry") {
            headers = ["Item Code", "Item Name", "Warehouse", "Batch No", "Expiry Date", "Days to Expiry", "Qty", "Rate", "Batch Value", "Status"];
            row_mapper = (r) => [r.item_code, r.item_name || "", r.warehouse, r.batch_no, r.expiry_date || "", r.days_to_expiry, r.bal_qty, r.val_rate, r.bal_val, r.status];
        }
        else if (active_tab === "abc_analysis") {
            let based_on = abc_based_on_filter ? abc_based_on_filter.get_value() : "Stock Value";
            let qty_lbl = "Qty";
            let val_lbl = "Value";
            let val_pct_lbl = "Value %";
            let cum_lbl = "Cumulative Value";
            let cum_pct_lbl = "Cumulative Value %";

            if (based_on.includes("Quantity")) {
                val_pct_lbl = "Qty %";
                cum_lbl = "Cumulative Qty";
                cum_pct_lbl = "Cumulative Qty %";
            }

            headers = ["Item Code", "Item Name", "Item Group", "UOM", qty_lbl, "Avg Rate", val_lbl, val_pct_lbl, cum_lbl, cum_pct_lbl, "ABC Class"];
            row_mapper = (r) => [
                r.item_code, 
                r.item_name || "", 
                r.item_group || "", 
                r.stock_uom || "", 
                r.qty, 
                r.rate, 
                r.value, 
                r.value_percent, 
                r.cumulative_value, 
                r.cumulative_percent, 
                r.abc_class
            ];
        }
        
        let csv_rows = [];
        csv_rows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(","));
        
        filtered_table_data.forEach(row => {
            let row_data = row_mapper(row);
            csv_rows.push(row_data.map(val => {
                let cell_val = val === null || val === undefined ? "" : String(val);
                return `"${cell_val.replace(/"/g, '""')}"`;
            }).join(","));
        });
        
        let csv_content = "data:text/csv;charset=utf-8," + csv_rows.join("\n");
        let encoded_uri = encodeURI(csv_content);
        
        let link = document.createElement("a");
        link.setAttribute("href", encoded_uri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Inject CSS styles inside head element
    function inject_styles() {
        if ($("#inventory-analytics-custom-css").length) return;
        
        $(`
            <style id="inventory-analytics-custom-css">
                .inventory-analytics-dashboard {
                    padding: 15px 0;
                    font-family: inherit;
                }
                
                /* Sleek Tab Navigation */
                .tabs-container {
                    display: flex;
                    gap: 10px;
                    border-bottom: 2px solid var(--border-color, #e2e8f0);
                    margin-bottom: 20px;
                    padding-bottom: 5px;
                }
                .tab-btn {
                    background: transparent;
                    border: none;
                    outline: none !important;
                    padding: 10px 18px;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-muted, #718096);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .tab-btn:hover {
                    background: var(--bg-light-gray, #f7fafc);
                    color: var(--text-color, #2d3748);
                }
                .tab-btn.active {
                    color: var(--primary, #3182ce);
                    background: #ebf8ff;
                }
                .tab-btn.active i {
                    color: var(--primary, #3182ce);
                }
                
                /* KPI Card Layouts */
                .kpi-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                }
                .kpi-card {
                    background: #fff;
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px;
                    padding: 15px 20px;
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                .kpi-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 6px rgba(0,0,0,0.05);
                }
                .kpi-icon {
                    font-size: 24px;
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: var(--bg-light-gray, #f7fafc);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .kpi-info {
                    display: flex;
                    flex-direction: column;
                }
                .kpi-label {
                    font-size: 12px;
                    color: var(--text-muted, #718096);
                    font-weight: 500;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .kpi-val {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 700;
                    color: var(--text-color, #2d3748);
                }
                .text-teal {
                    color: #319795 !important;
                }
                
                .charts-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-bottom: 20px;
                }
                @media (max-width: 991px) {
                    .charts-grid {
                        grid-template-columns: 1fr;
                    }
                }
                .chart-card {
                    background: #fff;
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px;
                    padding: 18px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    display: flex;
                    flex-direction: column;
                }
                .chart-header {
                    margin-bottom: 15px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #edf2f7;
                }
                .chart-title {
                    font-weight: 600;
                    font-size: 14px;
                    color: var(--text-color, #2d3748);
                }
                
                /* Widget 1: Premium Vertical Progress Bars Ranking */
                .widget-ranking-container {
                    min-height: 250px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .ranking-item {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 6px 8px;
                    border-radius: 6px;
                    transition: background-color 0.2s ease;
                }
                .ranking-item:hover {
                    background-color: #f7fafc;
                }
                .ranking-header-row {
                    display: flex;
                    align-items: center;
                    font-size: 13px;
                }
                .ranking-rank {
                    font-weight: 800;
                    font-size: 13px;
                    width: 25px;
                }
                .ranking-code {
                    font-weight: 600;
                    color: var(--primary, #3182ce);
                    flex-grow: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    padding-right: 10px;
                }
                .ranking-value {
                    font-size: 13px;
                    color: var(--text-color, #2d3748);
                    text-align: right;
                }
                .ranking-name {
                    font-size: 11px;
                    margin-left: 25px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .ranking-bar-bg {
                    margin-left: 25px;
                    background-color: #edf2f7;
                    height: 6px;
                    border-radius: 3px;
                    overflow: hidden;
                }
                .ranking-bar {
                    height: 100%;
                    border-radius: 3px;
                    transition: width 0.8s cubic-bezier(0.1, 0.8, 0.25, 1);
                }
                
                /* Widget 2: Premium Horizontal Segmented Bar & Interactive Grid Legend */
                .widget-donut-container {
                    min-height: 250px;
                    display: flex;
                    align-items: flex-start;
                    justify-content: flex-start;
                    flex-direction: column;
                    width: 100%;
                }
                .distribution-section {
                    width: 100%;
                    margin-bottom: 30px;
                }
                .distribution-section:last-child {
                    margin-bottom: 0;
                }
                .distribution-section-title {
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--text-muted, #718096);
                    margin-bottom: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.75px;
                }
                .distribution-bar-wrapper {
                    width: 100%;
                    margin-bottom: 20px;
                }
                .distribution-bar {
                    display: flex;
                    height: 24px;
                    width: 100%;
                    background-color: #edf2f7;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
                    position: relative;
                }
                .bar-segment {
                    height: 100%;
                    transition: flex-grow 0.3s ease, width 0.3s ease, filter 0.2s ease, transform 0.2s ease;
                    cursor: pointer;
                    position: relative;
                }
                .bar-segment:hover {
                    filter: brightness(1.15);
                    transform: scaleY(1.1);
                    z-index: 10;
                }
                .distribution-legend {
                    width: 100%;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                    gap: 12px;
                }
                .legend-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    border: 1px solid var(--border-color, #e2e8f0);
                    cursor: pointer;
                    background-color: #fff;
                    transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
                }
                .legend-item:hover {
                    border-color: var(--primary, #3182ce);
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                    background-color: #f7fafc;
                }
                .legend-item.active-legend {
                    border-color: var(--primary, #3182ce);
                    background-color: #ebf8ff;
                    box-shadow: 0 0 0 1px #3182ce;
                }
                .legend-pill {
                    transition: all 0.2s ease;
                }
                .legend-pill:hover {
                    border-color: var(--primary, #3182ce) !important;
                    background-color: #f7fafc !important;
                }
                .legend-pill.active-pill {
                    border-color: var(--primary, #3182ce) !important;
                    box-shadow: 0 0 0 1px #3182ce;
                    background: #ebf8ff !important;
                    color: #3182ce !important;
                }
                .legend-color {
                    width: 12px;
                    height: 12px;
                    border-radius: 4px;
                    flex-shrink: 0;
                }
                .legend-info {
                    display: flex;
                    flex-direction: column;
                    flex-grow: 1;
                    overflow: hidden;
                }
                .legend-label-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    width: 100%;
                    margin-bottom: 2px;
                }
                .legend-label {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-color, #2d3748);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    margin-right: 8px;
                }
                .legend-percentage {
                    font-size: 11px;
                    font-weight: 700;
                    color: #718096;
                }
                .legend-value {
                    font-size: 12px;
                    color: #4a5568;
                }

                
                /* Search panel and filter badge styles */
                .panel-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                    gap: 15px;
                    flex-wrap: wrap;
                }
                .search-box-wrapper {
                    position: relative;
                    max-width: 400px;
                    flex-grow: 1;
                }
                .item-search-input {
                    padding-left: 35px;
                    border-radius: 20px;
                }
                .search-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--text-muted, #a0aec0);
                }
                .table-filter-info {
                    display: flex;
                    align-items: center;
                    flex-grow: 1;
                }
                .sub-filter-badge {
                    background-color: #ebf8ff;
                    color: #2b6cb0;
                    border: 1px solid #bee3f8;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .remove-filter-btn {
                    cursor: pointer;
                    color: #e53e3e;
                    transition: color 0.1s ease;
                }
                .remove-filter-btn:hover {
                    color: #9b2c2c;
                }
                .results-count {
                    font-size: 13px;
                    color: var(--text-muted, #718096);
                    font-weight: 500;
                }
                
                /* Table styles */
                .table-container {
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px;
                    overflow-x: auto;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    background: #fff;
                }
                .inventory-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }
                 .inventory-table th {
                    background: var(--bg-light-gray, #f7fafc);
                    padding: 12px 15px;
                    font-weight: 600;
                    text-align: left;
                    color: var(--text-muted, #4a5568);
                    border-bottom: 1px solid var(--border-color, #e2e8f0);
                    cursor: pointer;
                    user-select: none;
                    transition: background-color 0.2s, color 0.2s;
                    white-space: nowrap;
                }
                .inventory-table th:hover {
                    background: #edf2f7;
                    color: var(--primary, #3182ce);
                }
                .inventory-table th i {
                    font-size: 11px;
                    margin-left: 5px;
                }
                .active-sort {
                    color: var(--primary, #3182ce) !important;
                }
                .inventory-table td {
                    padding: 12px 15px;
                    border-bottom: 1px solid var(--border-color, #edf2f7);
                    vertical-align: middle;
                    white-space: nowrap;
                }
                .inventory-table tbody tr:hover {
                    background: #f7fafc;
                }
                .document-link {
                    color: var(--link-color, #3182ce);
                    font-weight: 600;
                    cursor: pointer;
                    text-decoration: none;
                }
                .document-link:hover {
                    text-decoration: underline;
                }
                .badge {
                    padding: 3px 8px;
                    font-size: 10px;
                    font-weight: 600;
                    border-radius: 12px;
                    text-transform: uppercase;
                }
                .badge-danger {
                    background-color: #fed7d7;
                    color: #9b2c2c;
                }
                .badge-warning {
                    background-color: #feebc8;
                    color: #9c4221;
                }
                .badge-success {
                    background-color: #c6f6d5;
                    color: #22543d;
                }
                .font-weight-bold {
                    font-weight: 600;
                }
                
                .analysis-widgets-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-bottom: 20px;
                }
                @media (max-width: 991px) {
                    .analysis-widgets-grid {
                        grid-template-columns: 1fr;
                    }
                }
                .analysis-widget-card {
                    background: #fff;
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px;
                    padding: 18px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    display: flex;
                    flex-direction: column;
                }
                .widget-header {
                    margin-bottom: 15px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #edf2f7;
                }
                .widget-title {
                    font-weight: 600;
                    font-size: 14px;
                    color: var(--text-color, #2d3748);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .item-analysis-subtable {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .item-analysis-subtable th {
                    background: #f7fafc;
                    padding: 8px 10px;
                    color: #718096;
                    font-weight: 600;
                    border-bottom: 1px solid #e2e8f0;
                    text-align: left;
                }
                .item-analysis-subtable td {
                    padding: 8px 10px;
                    border-bottom: 1px solid #edf2f7;
                }
                .supplier-details-table-wrapper {
                    max-height: 250px;
                    overflow-y: auto;
                }
                .reorder-section-card {
                    background: #fff;
                    border: 1px solid var(--border-color, #e2e8f0);
                    border-radius: 8px;
                    padding: 18px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }
                .reorder-section-header {
                    margin-bottom: 12px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #edf2f7;
                }
                .reorder-section-title {
                    font-weight: 700;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .urgency-bar-wrapper {
                    background-color: #edf2f7;
                    height: 16px;
                    border-radius: 8px;
                    overflow: hidden;
                    position: relative;
                    width: 100%;
                }
                .urgency-bar {
                    height: 100%;
                    border-radius: 8px;
                    transition: width 0.3s ease;
                }
                .urgency-text {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 9px;
                    font-weight: 800;
                    color: #2d3748;
                    pointer-events: none;
                }
                .alert-success-card {
                    background: #f0fff4;
                    border: 1px solid #c6f6d5;
                }
                .alert-success-body {
                    display: flex;
                    gap: 12px;
                    align-items: flex-start;
                }
                /* Hide default internal legends inside the SVG to let pie charts expand fully */
                .frappe-chart .legend-container,
                .frappe-chart .legend,
                .frappe-chart .chart-legend {
                    display: none !important;
                }
            </style>
        `).appendTo("head");
    }
    
    // Render the item analysis tab dashboard content
    function render_item_analysis_tab(data) {
        // Render KPIs
        let kpi_container = $wrapper.find("#kpi-container");
        kpi_container.empty();
        kpi_container.html(`
            <div class="kpi-card" id="kpi-item-qty">
                <div class="kpi-icon"><i class="fa fa-cubes text-info"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Current Stock Qty")}</span>
                    <h3 class="kpi-val">${frappe.format(data.kpis.total_qty, {fieldtype: 'Float'})}</h3>
                </div>
            </div>
            <div class="kpi-card" id="kpi-item-val">
                <div class="kpi-icon"><i class="fa fa-money text-success"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Stock Valuation")}</span>
                    <h3 class="kpi-val">${format_currency(data.kpis.total_val, data.currency)}</h3>
                </div>
            </div>
            <div class="kpi-card" id="kpi-item-reorder">
                <div class="kpi-icon"><i class="fa fa-bell text-warning"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Reorder Level")}</span>
                    <h3 class="kpi-val">${frappe.format(data.kpis.reorder_level, {fieldtype: 'Float'})}</h3>
                </div>
            </div>
            <div class="kpi-card" id="kpi-item-leadtime">
                <div class="kpi-icon"><i class="fa fa-truck text-teal"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Average Lead Time")}</span>
                    <h3 class="kpi-val">${data.kpis.lead_time_days ? Math.round(data.kpis.lead_time_days) + ' ' + __('Days') : __('N/A')}</h3>
                </div>
            </div>
        `);

        // Check if item or item group is selected
        if (!item_filter.get_value() && !item_group_filter.get_value()) {
            kpi_container.empty();
            $wrapper.find(".table-container").html(`
                <div class="empty-state text-center py-5">
                    <i class="fa fa-search-plus text-muted" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <h4 class="text-muted">${__("Item & Item Group Analysis")}</h4>
                    <p class="text-muted">${__("Please select an Item or an Item Group from the filters above to load the analytical breakdown.")}</p>
                </div>
            `);
            return;
        }

        // Build Stock Ageing bar segments & legend
        let ageing_bar_html = "";
        let ageing_legend_html = "";
        let age_keys = ["0-30", "30-60", "60-90", ">90"];
        let age_labels = {
            "0-30": __("0-30 Days (Fast)"),
            "30-60": __("30-60 Days (Active)"),
            "60-90": __("60-90 Days (Slow)"),
            ">90": __(">90 Days (Non-Moving)")
        };
        let age_colors = {
            "0-30": "#38a169",
            "30-60": "#ecc94b",
            "60-90": "#dd6b20",
            ">90": "#e53e3e"
        };

        age_keys.forEach(bucket => {
            let b_data = data.ageing[bucket];
            let b_qty = b_data.qty;
            let b_val = b_data.val;
            let pct = data.kpis.total_qty > 0 ? (b_qty / data.kpis.total_qty) * 100 : 0;

            if (pct > 0) {
                ageing_bar_html += `
                    <div class="bar-segment" 
                         style="background-color: ${age_colors[bucket]}; flex: ${pct} 1 auto; min-width: 6px;" 
                         title="${age_labels[bucket]}: ${frappe.format(b_qty, {fieldtype: 'Float'})} (${pct.toFixed(1)}%)">
                    </div>
                `;
            }

            ageing_legend_html += `
                <div class="legend-item" style="cursor: default;">
                    <span class="legend-color" style="background-color: ${age_colors[bucket]}"></span>
                    <div class="legend-info">
                        <div class="legend-label-row">
                            <span class="legend-label" title="${age_labels[bucket]}">${age_labels[bucket]}</span>
                            <span class="legend-percentage">${pct.toFixed(1)}%</span>
                        </div>
                        <span class="legend-value">${frappe.format(b_qty, {fieldtype: 'Float'})} (${format_currency(b_val, data.currency)})</span>
                    </div>
                </div>
            `;
        });

        if (!ageing_bar_html) {
            ageing_bar_html = `<div style="text-align: center; width: 100%; color: #718096; font-size: 12px; line-height: 24px;">${__("No stock in hand to age")}</div>`;
        }

        // Build Supplier rows
        let supplier_rows_html = "";
        if (data.suppliers && data.suppliers.length > 0) {
            data.suppliers.forEach(sup => {
                supplier_rows_html += `
                    <tr>
                        <td><a class="document-link" onclick="frappe.set_route('Form', 'Supplier', '${sup.supplier}')">${sup.supplier}</a></td>
                        <td>${sup.supplier_part_no || "-"}</td>
                        <td class="text-right font-weight-bold">${sup.lead_time || 0} ${__("Days")}</td>
                    </tr>
                `;
            });
        } else {
            supplier_rows_html = `<tr><td colspan="3" class="text-center text-muted py-4">${__("No supplier details configured")}</td></tr>`;
        }

        // Build Urgency Reorders table
        let urgency_html = "";
        if (data.urgency_reorders && data.urgency_reorders.length > 0) {
            let urgency_rows = "";
            data.urgency_reorders.forEach(r => {
                let pct = Math.min(100, Math.max(0, r.ratio * 100));
                let color = pct <= 20 ? "#e53e3e" : (pct <= 60 ? "#dd6b20" : "#ecc94b");
                
                urgency_rows += `
                    <tr>
                        <td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${r.item_code}')">${r.item_code}</a><br><small class="text-muted">${r.item_name || ""}</small></td>
                        <td><a class="document-link" onclick="frappe.set_route('Form', 'Warehouse', '${r.warehouse}')">${r.warehouse}</a></td>
                        <td class="text-right font-weight-bold text-danger">${frappe.format(r.bal_qty, {fieldtype: 'Float'})}</td>
                        <td class="text-right">${frappe.format(r.reorder_level, {fieldtype: 'Float'})}</td>
                        <td class="text-right text-danger font-weight-bold">-${frappe.format(r.deficit, {fieldtype: 'Float'})}</td>
                        <td>
                            <div class="urgency-bar-wrapper" title="${pct.toFixed(0)}% of reorder level">
                                <div class="urgency-bar" style="width: ${pct}%; background-color: ${color};"></div>
                                <span class="urgency-text">${pct.toFixed(0)}%</span>
                            </div>
                        </td>
                        <td><span class="badge badge-warning">${r.material_request_type || __("Purchase")}</span></td>
                    </tr>
                `;
            });

            urgency_html = `
                <div class="reorder-section-card" style="margin-bottom: 20px;">
                    <div class="reorder-section-header">
                        <span class="reorder-section-title text-danger"><i class="fa fa-exclamation-triangle"></i> ${__("Items Reaching Reorder Level (Urgency Priority)")}</span>
                    </div>
                    <div class="reorder-table-wrapper" style="overflow-x: auto;">
                        <table class="inventory-table">
                            <thead>
                                <tr>
                                    <th>${__("Item")}</th>
                                    <th>${__("Warehouse")}</th>
                                    <th class="text-right">${__("Current Stock")}</th>
                                    <th class="text-right">${__("Reorder Level")}</th>
                                    <th class="text-right">${__("Deficit")}</th>
                                    <th style="width: 150px;">${__("Stock Ratio")}</th>
                                    <th>${__("Request Type")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${urgency_rows}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            urgency_html = `
                <div class="reorder-section-card alert-success-card" style="margin-bottom: 20px;">
                    <div class="alert-success-body">
                        <i class="fa fa-check-circle" style="font-size: 20px; color: #38a169;"></i>
                        <div>
                            <strong>${__("All Stocks Healthy")}</strong>
                            <p style="margin: 4px 0 0 0; font-size: 12px; color: #4a5568;">${__("None of the selected item(s) are currently at or below their configured warehouse reorder levels.")}</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Build All Reorders table
        let all_reorders_rows = "";
        if (data.reorders && data.reorders.length > 0) {
            data.reorders.forEach(r => {
                let status_badge = r.status === "Okay" ? "badge-success" : "badge-danger";
                all_reorders_rows += `
                    <tr>
                        <td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${r.item_code}')">${r.item_code}</a><br><small class="text-muted">${r.item_name || ""}</small></td>
                        <td><a class="document-link" onclick="frappe.set_route('Form', 'Warehouse', '${r.warehouse}')">${r.warehouse}</a></td>
                        <td class="text-right font-weight-bold">${frappe.format(r.bal_qty, {fieldtype: 'Float'})}</td>
                        <td class="text-right">${frappe.format(r.reorder_level, {fieldtype: 'Float'})}</td>
                        <td class="text-right">${frappe.format(r.reorder_qty, {fieldtype: 'Float'})}</td>
                        <td><span class="badge ${status_badge}">${__(r.status)}</span></td>
                        <td><span class="badge badge-light" style="background-color: #edf2f7; color: #4a5568;">${r.material_request_type || __("Purchase")}</span></td>
                    </tr>
                `;
            });
        } else {
            all_reorders_rows = `<tr><td colspan="7" class="text-center text-muted py-4">${__("No reorder levels configured for this item.")}</td></tr>`;
        }

        let all_reorders_html = `
            <div class="reorder-section-card">
                <div class="reorder-section-header">
                    <span class="reorder-section-title"><i class="fa fa-list-ul"></i> ${__("All Reorder Level Configurations")}</span>
                </div>
                <div class="reorder-table-wrapper" style="overflow-x: auto;">
                    <table class="inventory-table">
                        <thead>
                            <tr>
                                <th>${__("Item")}</th>
                                <th>${__("Warehouse")}</th>
                                <th class="text-right">${__("Current Stock")}</th>
                                <th class="text-right">${__("Reorder Level")}</th>
                                <th class="text-right">${__("Reorder Qty")}</th>
                                <th>${__("Status")}</th>
                                <th>${__("Request Type")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${all_reorders_rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // Render everything to main container
        let container = $wrapper.find(".table-container");
        container.empty();
        container.html(`
            <div class="analysis-widgets-grid">
                <!-- Stock Ageing Widget -->
                <div class="analysis-widget-card">
                    <div class="widget-header">
                        <span class="widget-title"><i class="fa fa-clock-o"></i> ${__("Stock Ageing Profile (FIFO)")}</span>
                    </div>
                    <div class="widget-body">
                        <div class="distribution-bar-wrapper" style="margin-bottom: 20px;">
                            <div class="distribution-bar">
                                ${ageing_bar_html}
                            </div>
                        </div>
                        <div class="distribution-legend" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            ${ageing_legend_html}
                        </div>
                    </div>
                </div>

                <!-- Warehouse Distribution Widget -->
                <div class="analysis-widget-card">
                    <div class="widget-header">
                        <span class="widget-title"><i class="fa fa-building"></i> ${__("Warehouse Stock Distribution")}</span>
                    </div>
                    <div class="widget-body">
                        <div id="warehouse-dist-chart" style="height: 250px;"></div>
                    </div>
                </div>

                <!-- Monthly Consumption vs Receipts Trend Widget -->
                <div class="analysis-widget-card">
                    <div class="widget-header">
                        <span class="widget-title"><i class="fa fa-area-chart"></i> ${__("Monthly Consumption vs Receipts Trend")}</span>
                    </div>
                    <div class="widget-body">
                        <div id="monthly-trend-chart" style="height: 250px;"></div>
                    </div>
                </div>

                <!-- Supplier Details Widget -->
                <div class="analysis-widget-card">
                    <div class="widget-header">
                        <span class="widget-title"><i class="fa fa-truck"></i> ${__("Supplier Lead Time Details")}</span>
                    </div>
                    <div class="widget-body supplier-details-table-wrapper">
                        <table class="item-analysis-subtable">
                            <thead>
                                <tr>
                                    <th>${__("Supplier")}</th>
                                    <th>${__("Supplier Part No")}</th>
                                    <th class="text-right">${__("Lead Time")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${supplier_rows_html}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Reorder Urgency Section -->
            ${urgency_html}

            <!-- All Reorder Configurations Section -->
            ${all_reorders_html}
        `);

        // Render charts after DOM insertion
        // 1. Warehouse Distribution Chart
        let wh_labels = [];
        let wh_values = [];
        if (data.warehouse_distribution && data.warehouse_distribution.length > 0) {
            wh_labels = data.warehouse_distribution.map(wh => wh.warehouse);
            wh_values = data.warehouse_distribution.map(wh => wh.qty);
        }

        if (wh_labels.length > 0) {
            new frappe.Chart("#warehouse-dist-chart", {
                data: {
                    labels: wh_labels,
                    datasets: [{ values: wh_values }]
                },
                type: "donut",
                height: 220,
                colors: ["#3182ce", "#38a169", "#ecc94b", "#e53e3e", "#805ad5", "#319795"]
            });
        } else {
            $wrapper.find("#warehouse-dist-chart").html(`<div class="text-center text-muted py-5">${__("No warehouse distribution found")}</div>`);
        }

        // 2. Monthly Trend Chart
        let trend_labels = [];
        let receipts_data = [];
        let issues_data = [];
        if (data.monthly_trend && data.monthly_trend.length > 0) {
            trend_labels = data.monthly_trend.map(t => t.month_name);
            receipts_data = data.monthly_trend.map(t => t.receipts);
            issues_data = data.monthly_trend.map(t => t.issues);
        }

        if (trend_labels.length > 0) {
            new frappe.Chart("#monthly-trend-chart", {
                data: {
                    labels: trend_labels,
                    datasets: [
                        {
                            name: __("Receipts"),
                            chartType: "bar",
                            values: receipts_data
                        },
                        {
                            name: __("Consumption"),
                            chartType: "bar",
                            values: issues_data
                        }
                    ]
                },
                type: "bar",
                height: 220,
                colors: ["#48bb78", "#f56565"], // green-500, red-500
                barOptions: {
                    stacked: false,
                    spaceRatio: 0.2
                },
                tooltipOptions: {
                    formatTooltipY: d => frappe.format(d, {fieldtype: 'Float'})
                }
            });
        } else {
            $wrapper.find("#monthly-trend-chart").html(`<div class="text-center text-muted py-5">${__("No monthly transactions recorded")}</div>`);
        }

        // --- Sr. 1 & Sr. 2: Daily Stock Transactions Section ---
        let daily_section = $(`
            <div class="reorder-section-card" style="margin-top: 20px;">
                <div class="reorder-section-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="reorder-section-title"><i class="fa fa-calendar"></i> ${__("Daily Stock Transactions (Last 30 Days)")}</span>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <input type="date" id="daily-from-date" class="form-control" style="width:140px;font-size:12px;" value="${frappe.datetime.add_days(frappe.datetime.get_today(), -30)}" />
                        <span style="font-size:12px;color:#718096;">to</span>
                        <input type="date" id="daily-to-date" class="form-control" style="width:140px;font-size:12px;" value="${frappe.datetime.get_today()}" />
                        <button class="btn btn-sm btn-default" id="load-daily-btn" style="font-size:12px;">
                            <i class="fa fa-refresh"></i> ${__("Load")}
                        </button>
                    </div>
                </div>
                <div id="daily-transactions-body">
                    <div class="text-center text-muted py-3" style="font-size:12px;">${__("Click Load to fetch daily transactions for the selected period.")}</div>
                </div>
            </div>
        `);
        container.append(daily_section);

        // Bind load button for daily transactions
        $wrapper.off("click", "#load-daily-btn").on("click", "#load-daily-btn", function() {
            let daily_from = $wrapper.find("#daily-from-date").val();
            let daily_to = $wrapper.find("#daily-to-date").val();
            let daily_body = $wrapper.find("#daily-transactions-body");
            daily_body.html(`<div class="text-center text-muted py-3"><i class="fa fa-spinner fa-spin"></i> ${__("Loading...")}</div>`);

            frappe.call({
                method: "esoft_custom_bom.esoft_custom_bom.page.inventory_analytics.inventory_analytics.get_daily_transactions",
                args: {
                    company: company_filter.get_value(),
                    warehouse: warehouse_filter.get_value(),
                    item_group: item_group_filter.get_value(),
                    item_code: item_filter.get_value(),
                    from_date: daily_from,
                    to_date: daily_to
                },
                callback: function(r) {
                    let rows = r.message || [];
                    if (rows.length === 0) {
                        daily_body.html(`<div class="text-center text-muted py-3" style="font-size:12px;">${__("No transactions found for this period.")}</div>`);
                        return;
                    }
                    let rows_html = rows.map(row => {
                        let is_received = row.direction === "Received";
                        let dir_badge = is_received
                            ? `<span class="badge" style="background:#c6f6d5;color:#22543d;">${__("Received")}</span>`
                            : `<span class="badge" style="background:#fed7d7;color:#9b2c2c;">${__("Issued")}</span>`;
                        let qty_str = is_received
                            ? `<span class="text-success font-weight-bold">+${frappe.format(row.actual_qty, {fieldtype:'Float'})}</span>`
                            : `<span class="text-danger font-weight-bold">-${frappe.format(Math.abs(row.actual_qty), {fieldtype:'Float'})}</span>`;
                        return `<tr>
                            <td>${frappe.datetime.str_to_user(row.posting_date) || row.posting_date}</td>
                            <td>${dir_badge}</td>
                            <td><small class="text-muted">${row.voucher_type}</small><br><a class="document-link" onclick="frappe.set_route('Form', '${row.voucher_type}', '${row.voucher_no}')">${row.voucher_no}</a></td>
                            <td><a class="document-link" onclick="frappe.set_route('Form', 'Item', '${row.item_code}')">${row.item_code}</a><br><small class="text-muted">${row.item_name || ''}</small></td>
                            <td>${row.warehouse}</td>
                            <td class="text-right">${qty_str}</td>
                        </tr>`;
                    }).join("");
                    daily_body.html(`
                        <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
                            <table class="inventory-table" style="font-size:12px;">
                                <thead>
                                    <tr>
                                        <th>${__("Date")}</th>
                                        <th>${__("Direction")}</th>
                                        <th>${__("Voucher")}</th>
                                        <th>${__("Item")}</th>
                                        <th>${__("Warehouse")}</th>
                                        <th class="text-right">${__("Qty")}</th>
                                    </tr>
                                </thead>
                                <tbody>${rows_html}</tbody>
                            </table>
                        </div>
                        <div style="padding:8px 15px;font-size:12px;color:#718096;">${__("Showing")} ${rows.length} ${__("transactions")}${rows.length === 500 ? ' (' + __("limited to 500") + ')' : ''}</div>
                    `);
                }
            });
        });
    }

    // Sr. 15: Render the Material Fulfillment tab
    function render_fulfillment_tab(data) {
        // KPIs
        let kpi_container = $wrapper.find("#kpi-container");
        kpi_container.empty();
        let kpis = data.kpis || {};
        kpi_container.html(`
            <div class="kpi-card">
                <div class="kpi-icon"><i class="fa fa-list-alt text-info"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Total MR Items")}</span>
                    <h3 class="kpi-val">${kpis.total_items || 0}</h3>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon"><i class="fa fa-clock-o text-warning" style="color: #ecc94b;"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Pending Items")}</span>
                    <h3 class="kpi-val">${kpis.pending_count || 0}</h3>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon"><i class="fa fa-hourglass-half text-info"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Partially Issued")}</span>
                    <h3 class="kpi-val">${kpis.partial_count || 0}</h3>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon"><i class="fa fa-exclamation-circle text-danger" style="color: #e53e3e;"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Overdue Items")}</span>
                    <h3 class="kpi-val text-danger font-weight-bold">${kpis.overdue_count || 0}</h3>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon"><i class="fa fa-check-circle text-success"></i></div>
                <div class="kpi-info">
                    <span class="kpi-label">${__("Fulfilled Items")}</span>
                    <h3 class="kpi-val">${kpis.fulfilled_count || 0}</h3>
                </div>
            </div>
        `);

        // Fulfillment status distribution bar & containers
        let donut_container = $wrapper.find("#widget-donut-content");
        let ranking_container = $wrapper.find("#widget-ranking-content");
        
        // Dynamically add/show Item Group Widget Card in charts grid
        let charts_grid = $wrapper.find(".charts-grid");
        let ig_widget = charts_grid.find("#widget-item-group-card");
        if (ig_widget.length === 0) {
            charts_grid.append(`
                <div class="chart-card" id="widget-item-group-card">
                    <div class="chart-header">
                        <span class="chart-title" id="widget-item-group-title">${__("Pending Requests by Item Group")}</span>
                    </div>
                    <div id="widget-item-group-content" class="widget-ranking-container">
                        <!-- Item Group list goes here -->
                    </div>
                </div>
            `);
            ig_widget = charts_grid.find("#widget-item-group-card");
        }
        ig_widget.show();

        // Dynamically add/show Purpose Widget Card in charts grid
        let purpose_widget = charts_grid.find("#widget-purpose-card");
        if (purpose_widget.length === 0) {
            charts_grid.append(`
                <div class="chart-card" id="widget-purpose-card">
                    <div class="chart-header">
                        <span class="chart-title" id="widget-purpose-title">${__("Pending Requests by Purpose")}</span>
                    </div>
                    <div id="widget-purpose-content" class="widget-ranking-container">
                        <!-- Purpose list goes here -->
                    </div>
                </div>
            `);
            purpose_widget = charts_grid.find("#widget-purpose-card");
        }
        purpose_widget.show();

        $wrapper.find(".charts-grid").show();
        $wrapper.find("#widget-ranking-title").text(__("Top Pending Items by Qty"));
        $wrapper.find("#widget-donut-title").text(__("MR Status Distribution"));
        
        // Setup flex container styling on all 4 widget content areas to prevent collapse
        ranking_container.attr("style", "").css({
            "display": "flex",
            "flex-direction": "column",
            "justify-content": "space-between",
            "height": "100%",
            "padding": "0 10px",
            "align-items": "stretch",
            "width": "100%",
            "min-height": "unset"
        });
        donut_container.attr("style", "").css({
            "display": "flex",
            "flex-direction": "column",
            "justify-content": "space-between",
            "height": "100%",
            "padding": "0 10px",
            "align-items": "stretch",
            "width": "100%",
            "min-height": "unset"
        });
        
        let ig_content = $wrapper.find("#widget-item-group-content");
        ig_content.attr("style", "").css({
            "display": "flex",
            "flex-direction": "column",
            "justify-content": "space-between",
            "height": "100%",
            "padding": "0 10px",
            "align-items": "stretch",
            "width": "100%",
            "min-height": "unset"
        });
        
        let purpose_content = $wrapper.find("#widget-purpose-content");
        purpose_content.attr("style", "").css({
            "display": "flex",
            "flex-direction": "column",
            "justify-content": "space-between",
            "height": "100%",
            "padding": "0 10px",
            "align-items": "stretch",
            "width": "100%",
            "min-height": "unset"
        });

        ranking_container.empty();
        donut_container.empty();
        ig_content.empty();
        purpose_content.empty();

        let items = data.items || [];

        function toggle_mr_local_filter(key, value) {
            if (local_sub_filter && local_sub_filter.key === key && local_sub_filter.value === value) {
                local_sub_filter = null;
            } else {
                local_sub_filter = { key: key, value: value };
            }
            sort_and_render();
            render_fulfillment_tab(data);
        }

        // Widget 1: Top Pending Items (Horizontal/Vertical Bar Chart)
        let pending_items = items.filter(r => r.pending_qty > 0).sort((a, b) => b.pending_qty - a.pending_qty).slice(0, 5);
        if (pending_items.length === 0) {
            ranking_container.html(`<div class="text-center text-muted py-5">${__("No pending items found")}</div>`);
        } else {
            ranking_container.html(`
                <div class="chart-layout-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%; height: 180px; gap: 10px;">
                    <div class="chart-wrapper" style="flex: 1; height: 180px; min-width: 0;">
                        <div id="fulfillment-top-pending-chart" style="height: 180px; width: 100%;"></div>
                    </div>
                    <div class="legend-wrapper" id="fulfillment-top-pending-legend" style="width: 90px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; align-items: flex-start; max-height: 180px; overflow-y: auto; padding-left: 5px; min-width: 0;"></div>
                </div>
            `);
            
            let labels = pending_items.map(item => item.item_code);
            let values = pending_items.map(item => flt(item.pending_qty, 2));
            let colors = ["#e53e3e", "#dd6b20", "#ecc94b", "#4a5568", "#718096"];

            new frappe.Chart("#fulfillment-top-pending-chart", {
                data: {
                    labels: labels,
                    datasets: [{ values: values }]
                },
                type: "bar",
                height: 180,
                colors: colors,
                events: {
                    dataSelect: function(event) {
                        toggle_mr_local_filter("item_code", event.label);
                    }
                }
            });

            let legend_div = ranking_container.find("#fulfillment-top-pending-legend");
            pending_items.forEach((item, idx) => {
                let is_active = local_sub_filter && local_sub_filter.key === "item_code" && local_sub_filter.value === item.item_code;
                let pill = $(`
                    <button class="btn btn-xs legend-pill ${is_active ? 'active-pill' : ''}" style="margin: 1px 0; font-size: 9px; padding: 2px 4px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; justify-content: flex-start; overflow: hidden; min-width: 0;">
                        <span class="legend-color-dot" style="width: 6px; height: 6px; border-radius: 50%; background: ${colors[idx % colors.length]}; flex-shrink: 0;"></span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;">${item.item_code} (${flt(item.pending_qty, 1)})</span>
                    </button>
                `);
                pill.on("click", () => toggle_mr_local_filter("item_code", item.item_code));
                legend_div.append(pill);
            });
        }

        // Widget 2: Status Distribution (Pie Chart to prevent collapse/invisible issue)
        let total_items_count = kpis.total_items || 0;
        if (total_items_count === 0) {
            donut_container.html(`<div class="text-center text-muted py-5">${__("No status data available")}</div>`);
        } else {
            donut_container.html(`
                <div class="chart-layout-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%; height: 180px; gap: 10px;">
                    <div class="chart-wrapper" style="flex: 1; height: 180px; min-width: 0; overflow: hidden; position: relative;">
                        <div id="fulfillment-status-chart" style="height: 220px; width: 100%; margin-top: -10px;"></div>
                    </div>
                    <div class="legend-wrapper" id="fulfillment-status-legend" style="width: 90px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; align-items: flex-start; max-height: 180px; overflow-y: auto; padding-left: 5px; min-width: 0;"></div>
                </div>
            `);

            let status_counts = {
                Pending: kpis.pending_count || 0,
                Partial: kpis.partial_count || 0,
                Fulfilled: kpis.fulfilled_count || 0
            };
            let labels = [__("Pending"), __("Partial"), __("Fulfilled")];
            let values = [status_counts.Pending, status_counts.Partial, status_counts.Fulfilled];
            let colors = ["#e53e3e", "#ecc94b", "#38a169"];

            new frappe.Chart("#fulfillment-status-chart", {
                data: {
                    labels: labels,
                    datasets: [{ values: values }]
                },
                type: "pie",
                height: 220,
                colors: colors,
                events: {
                    dataSelect: function(event) {
                        let label = event.label;
                        let status_key = "Pending";
                        if (label === __("Partial")) status_key = "Partial";
                        if (label === __("Fulfilled")) status_key = "Fulfilled";
                        toggle_mr_local_filter("status", status_key);
                    }
                }
            });

            let legend_div = donut_container.find("#fulfillment-status-legend");
            let keys = ["Pending", "Partial", "Fulfilled"];
            keys.forEach((status_key, idx) => {
                let count = status_counts[status_key];
                if (count > 0 || status_key === "Pending") {
                    let is_active = local_sub_filter && local_sub_filter.key === "status" && local_sub_filter.value === status_key;
                    let pill = $(`
                        <button class="btn btn-xs legend-pill ${is_active ? 'active-pill' : ''}" style="margin: 1px 0; font-size: 9px; padding: 2px 4px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; justify-content: flex-start; overflow: hidden; min-width: 0;">
                            <span class="legend-color-dot" style="width: 6px; height: 6px; border-radius: 50%; background: ${colors[idx]}; flex-shrink: 0;"></span>
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;">${__(status_key)} (${count})</span>
                        </button>
                    `);
                    pill.on("click", () => toggle_mr_local_filter("status", status_key));
                    legend_div.append(pill);
                }
            });
        }

        // Widget 3: Pending Requests by Item Group (Vertical Bar Chart)
        let igs = data.item_groups || [];
        if (igs.length === 0) {
            ig_content.html(`<div class="text-center text-muted py-5">${__("No pending requests by item group")}</div>`);
        } else {
            ig_content.html(`
                <div class="chart-layout-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%; height: 180px; gap: 10px;">
                    <div class="chart-wrapper" style="flex: 1; height: 180px; min-width: 0;">
                        <div id="fulfillment-item-group-chart" style="height: 180px; width: 100%;"></div>
                    </div>
                    <div class="legend-wrapper" id="fulfillment-item-group-legend" style="width: 90px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; align-items: flex-start; max-height: 180px; overflow-y: auto; padding-left: 5px; min-width: 0;"></div>
                </div>
            `);

            let top_igs = igs.slice(0, 5);
            let labels = top_igs.map(ig => ig.item_group);
            let values = top_igs.map(ig => ig.count);
            let colors = ["#4c51bf", "#667eea", "#a3b1f5", "#7f9cf5", "#cbd5e0"];

            new frappe.Chart("#fulfillment-item-group-chart", {
                data: {
                    labels: labels,
                    datasets: [{ values: values }]
                },
                type: "bar",
                height: 180,
                colors: colors,
                events: {
                    dataSelect: function(event) {
                        toggle_mr_local_filter("item_group", event.label);
                    }
                }
            });

            let legend_div = ig_content.find("#fulfillment-item-group-legend");
            top_igs.forEach((ig, idx) => {
                let is_active = local_sub_filter && local_sub_filter.key === "item_group" && local_sub_filter.value === ig.item_group;
                let pill = $(`
                    <button class="btn btn-xs legend-pill ${is_active ? 'active-pill' : ''}" style="margin: 1px 0; font-size: 9px; padding: 2px 4px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; justify-content: flex-start; overflow: hidden; min-width: 0;">
                        <span class="legend-color-dot" style="width: 6px; height: 6px; border-radius: 50%; background: ${colors[idx % colors.length]}; flex-shrink: 0;"></span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;">${ig.item_group} (${ig.count})</span>
                    </button>
                `);
                pill.on("click", () => toggle_mr_local_filter("item_group", ig.item_group));
                legend_div.append(pill);
            });
        }

        // Widget 4: Pending Requests by Purpose (Pie Chart)
        let purposes = data.purposes || [];
        if (purposes.length === 0) {
            purpose_content.html(`<div class="text-center text-muted py-5">${__("No pending requests by purpose")}</div>`);
        } else {
            purpose_content.html(`
                <div class="chart-layout-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%; height: 180px; gap: 10px;">
                    <div class="chart-wrapper" style="flex: 1; height: 180px; min-width: 0; overflow: hidden; position: relative;">
                        <div id="fulfillment-purpose-chart" style="height: 220px; width: 100%; margin-top: -10px;"></div>
                    </div>
                    <div class="legend-wrapper" id="fulfillment-purpose-legend" style="width: 90px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; align-items: flex-start; max-height: 180px; overflow-y: auto; padding-left: 5px; min-width: 0;"></div>
                </div>
            `);

            let top_purposes = purposes.slice(0, 5);
            let labels = top_purposes.map(p => p.purpose);
            let values = top_purposes.map(p => p.count);
            let colors = ["#319795", "#805ad5", "#d69e2e", "#3182ce", "#4a5568"];

            new frappe.Chart("#fulfillment-purpose-chart", {
                data: {
                    labels: labels,
                    datasets: [{ values: values }]
                },
                type: "pie",
                height: 220,
                colors: colors,
                events: {
                    dataSelect: function(event) {
                        toggle_mr_local_filter("material_request_type", event.label);
                    }
                }
            });

            let legend_div = purpose_content.find("#fulfillment-purpose-legend");
            top_purposes.forEach((p, idx) => {
                let is_active = local_sub_filter && local_sub_filter.key === "material_request_type" && local_sub_filter.value === p.purpose;
                let pill = $(`
                    <button class="btn btn-xs legend-pill ${is_active ? 'active-pill' : ''}" style="margin: 1px 0; font-size: 9px; padding: 2px 4px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; justify-content: flex-start; overflow: hidden; min-width: 0;">
                        <span class="legend-color-dot" style="width: 6px; height: 6px; border-radius: 50%; background: ${colors[idx % colors.length]}; flex-shrink: 0;"></span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;">${__(p.purpose)} (${p.count})</span>
                    </button>
                `);
                pill.on("click", () => toggle_mr_local_filter("material_request_type", p.purpose));
                legend_div.append(pill);
            });
        }

        // Restore table container with fulfillment data structure
        let table_container = $wrapper.find(".table-container");
        if (table_container.find("#inventory-table").length === 0 || !table_container.find("#inventory-table-head").length) {
            table_container.html(`
                <table class="inventory-table" id="inventory-table">
                    <thead id="inventory-table-head"></thead>
                    <tbody id="inventory-table-body"></tbody>
                </table>
            `);
        }

        report_data = items;
        sort_and_render();
    }

    // Trigger initial load and set default sort dropdown options
    update_sort_dropdown_options();
    refresh_data();
};
