// Copyright (c) 2026, Abdul Mannan and contributors
// For license information, please see license.txt

frappe.pages["purchase-analytics"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Purchase Tracking & Analytics"),
        single_column: true
    });
    
    // Create the container for custom HTML/CSS
    var main_container = $('<div class="purchase-analytics-dashboard"></div>').appendTo(page.main);
    
    // Inject custom CSS to make it beautiful
    inject_styles();
    
    // Define filters
    let company_filter = page.add_field({
        fieldname: "company",
        label: __("Company"),
        fieldtype: "Link",
        options: "Company",
        default: frappe.defaults.get_user_default("Company"),
        change: () => refresh_data()
    });
    
    let supplier_filter = page.add_field({
        fieldname: "supplier",
        label: __("Supplier"),
        fieldtype: "Link",
        options: "Supplier",
        change: () => refresh_data()
    });
    
    let item_filter = page.add_field({
        fieldname: "item_code",
        label: __("Item"),
        fieldtype: "Link",
        options: "Item",
        change: () => refresh_data()
    });
    
    let status_filter = page.add_field({
        fieldname: "status_filter",
        label: __("Filter Status"),
        fieldtype: "Select",
        options: ["All Open", "Pending Only", "Overdue Only"],
        default: "All Open",
        change: () => refresh_data()
    });
    
    let from_date_filter = page.add_field({
        fieldname: "from_date",
        label: __("From Expected Date"),
        fieldtype: "Date",
        change: () => refresh_data()
    });
    
    let to_date_filter = page.add_field({
        fieldname: "to_date",
        label: __("To Expected Date"),
        fieldtype: "Date",
        change: () => refresh_data()
    });
    
    // Add primary actions (Refresh, Export)
    page.set_primary_action(__("Refresh"), () => refresh_data(), "refresh");
    page.set_secondary_action(__("Export CSV"), () => export_to_csv(), "download");
    
    // Setup dashboard HTML structure
    main_container.html(`
        <div id="po-tracking-dashboard">
            <!-- KPI Cards Grid -->
            <div class="kpi-grid">
                <div class="kpi-card" id="kpi-open-pos">
                    <div class="kpi-icon"><i class="fa fa-shopping-cart text-primary"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label" id="kpi-open-pos-label">Open Purchase Orders</span>
                        <h3 class="kpi-val" id="val-open-pos">0</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-pending-qty">
                    <div class="kpi-icon"><i class="fa fa-cubes text-info"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">Pending Quantity</span>
                        <h3 class="kpi-val" id="val-pending-qty">0</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-outstanding-val">
                    <div class="kpi-icon"><i class="fa fa-money text-success"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label" id="kpi-outstanding-val-label">Pending Value</span>
                        <h3 class="kpi-val" id="val-outstanding-val">0</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-pending-bill-val">
                    <div class="kpi-icon"><i class="fa fa-file-text-o text-warning"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">Pending Bill Value</span>
                        <h3 class="kpi-val" id="val-pending-bill-val">0</h3>
                    </div>
                </div>
                <div class="kpi-card" id="kpi-overdue-pos">
                    <div class="kpi-icon"><i class="fa fa-exclamation-circle text-danger"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">Overdue Items</span>
                        <h3 class="kpi-val" id="val-overdue-pos">0</h3>
                    </div>
                </div>
            </div>

            <!-- Charts Grid -->
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title" id="chart-supplier-title">Pending Value by Supplier</span>
                    </div>
                    <div id="chart-supplier" class="chart-container"></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title" id="chart-status-title">Overdue vs Pending Items</span>
                    </div>
                    <div id="chart-status" class="chart-container"></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title" id="chart-ageing-title">PO Ageing (No. of POs)</span>
                    </div>
                    <div id="chart-ageing" class="chart-container"></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title" id="chart-billing-title">Billing Status (by Value)</span>
                    </div>
                    <div id="chart-billing" class="chart-container"></div>
                </div>
            </div>
            
            <!-- Search & Info Panel -->
            <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap;">
                <div class="search-box-wrapper" style="flex: 1; min-width: 250px;">
                    <input type="text" id="po-search-input" class="form-control po-search-input" placeholder="Search by PO No, Supplier, Item Code or Name..." />
                    <i class="fa fa-search search-icon"></i>
                </div>
                <div class="filter-badges-wrapper" style="display: flex; gap: 10px; align-items: center;">
                    <div id="results-count" class="results-count">Showing 0 items</div>
                    <div id="active-ageing-badge" class="badge badge-info" style="display: none; cursor: pointer; padding: 6px 12px; font-size: 11px; border-radius: 12px; background-color: #3182ce; color: white;">
                        <span id="active-ageing-text"></span> <i class="fa fa-times" style="margin-left: 5px;"></i>
                    </div>
                    <div id="active-billing-badge" class="badge badge-info" style="display: none; cursor: pointer; padding: 6px 12px; font-size: 11px; border-radius: 12px; background-color: #319795; color: white;">
                        <span id="active-billing-text"></span> <i class="fa fa-times" style="margin-left: 5px;"></i>
                    </div>
                </div>
            </div>
            
            <!-- Table Area -->
            <div class="table-container">
                <table class="po-table" id="po-table">
                    <thead>
                        <tr>
                            <th data-sort="po_no">PO Number <i class="fa fa-sort"></i></th>
                            <th data-sort="po_date">PO Date <i class="fa fa-sort"></i></th>
                            <th data-sort="ageing_days" class="text-right">Ageing (Days) <i class="fa fa-sort"></i></th>
                            <th data-sort="required_date">Expected Date <i class="fa fa-sort"></i></th>
                            <th data-sort="supplier">Supplier <i class="fa fa-sort"></i></th>
                            <th data-sort="item_code">Item Code <i class="fa fa-sort"></i></th>
                            <th data-sort="item_name">Item Name <i class="fa fa-sort"></i></th>
                            <th data-sort="ordered_qty" class="text-right">Ordered Qty <i class="fa fa-sort"></i></th>
                            <th data-sort="outstanding_qty" class="text-right">Pending Qty <i class="fa fa-sort"></i></th>
                            <th data-sort="billed_qty" class="text-right">Billed Qty <i class="fa fa-sort"></i></th>
                            <th data-sort="pending_billed_qty" class="text-right">Pending Bill Qty <i class="fa fa-sort"></i></th>
                            <th data-sort="pending_bill_val" class="text-right">Pending Bill Value <i class="fa fa-sort"></i></th>
                            <th data-sort="rate" class="text-right">Rate <i class="fa fa-sort"></i></th>
                            <th data-sort="amount" class="text-right">Amount <i class="fa fa-sort"></i></th>
                        </tr>
                    </thead>
                    <tbody id="po-table-body">
                        <tr>
                            <td colspan="14" class="text-center text-muted">Loading data...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `);

    // State Variables
    let report_data = [];
    let po_current_page = 1;
    let po_page_size = 20;
    let current_sort = { key: "required_date", asc: true };
    let current_ageing_filter = null;
    let current_billing_filter = null;

    // Load and render data
    function refresh_data() {
        current_ageing_filter = null;
        current_billing_filter = null;
        let filters = {
            company: company_filter ? company_filter.get_value() : null,
            supplier: supplier_filter.get_value(),
            item_code: item_filter.get_value(),
            status_filter: status_filter.get_value(),
            from_date: from_date_filter.get_value(),
            to_date: to_date_filter.get_value()
        };
        
        frappe.call({
            method: "esoft_custom_bom.esoft_custom_bom.page.purchase_analytics.purchase_analytics.get_po_data",
            args: filters,
            callback: function(r) {
                if (r.message) {
                    report_data = r.message.items;
                    update_kpis(r.message.kpis, r.message.currency, filters.status_filter);
                    sort_and_render();
                    render_charts(r.message.items, filters.status_filter);
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

    function update_kpis(kpis, currency, status) {
        $("#val-open-pos").text(kpis.total_open_pos);
        
        let pending_qty_html = fmt_float(kpis.total_outstanding_qty);
        $("#val-pending-qty").text(pending_qty_html);
        
        let outstanding_val_html = format_currency_html(kpis.total_outstanding_val, currency);
        $("#val-outstanding-val").html(outstanding_val_html);

        let pending_bill_val_html = format_currency_html(kpis.total_pending_bill_val || 0, currency);
        $("#val-pending-bill-val").html(pending_bill_val_html);
        
        $("#val-overdue-pos").text(kpis.overdue_count);
        
        let label1 = __("Open Purchase Orders");
        let label3 = __("Pending Value");
        
        if (status === "Pending Only") {
            label1 = __("Pending Purchase Orders");
            label3 = __("Pending Value");
        } else if (status === "Overdue Only") {
            label1 = __("Overdue Purchase Orders");
            label3 = __("Overdue Value");
        }
        
        $("#kpi-open-pos-label").text(label1);
        $("#kpi-outstanding-val-label").text(label3);
        
        if (kpis.overdue_count > 0) {
            $("#kpi-overdue-pos").addClass("kpi-danger-pulse");
        } else {
            $("#kpi-overdue-pos").removeClass("kpi-danger-pulse");
        }
    }

    let supplier_chart = null;
    let status_chart = null;
    let ageing_chart = null;
    let billing_chart = null;

    function render_charts(data, status) {
        if (supplier_chart) {
            supplier_chart.destroy();
            supplier_chart = null;
        }
        if (status_chart) {
            status_chart.destroy();
            status_chart = null;
        }
        if (ageing_chart) {
            ageing_chart.destroy();
            ageing_chart = null;
        }
        if (billing_chart) {
            billing_chart.destroy();
            billing_chart = null;
        }
        
        $("#chart-supplier").empty();
        $("#chart-status").empty();
        $("#chart-ageing").empty();
        $("#chart-billing").empty();
        
        if (data.length === 0) return;

        let sorted_months = [];
        let sorted_items = [];

        let supplier_sums = {};
        data.forEach(row => {
            supplier_sums[row.supplier] = (supplier_sums[row.supplier] || 0) + row.outstanding_amount;
        });
        
        let sorted_suppliers = Object.keys(supplier_sums)
            .map(supplier => ({ name: supplier, value: supplier_sums[supplier] }))
            .sort((a, b) => b.value - a.value);
            
        let top_suppliers = sorted_suppliers.slice(0, 5);
        let others_val = sorted_suppliers.slice(5).reduce((sum, item) => sum + item.value, 0);
        
        if (others_val > 0) {
            top_suppliers.push({ name: __("Others"), value: others_val });
        }
        
        let supplier_labels = top_suppliers.map(s => s.name);
        let supplier_values = top_suppliers.map(s => Math.round(s.value));
        
        let chart1_title = __("Pending Value by Supplier");
        if (status === "Pending Only") chart1_title = __("Pending Value by Supplier");
        if (status === "Overdue Only") chart1_title = __("Overdue Value by Supplier");
        
        $("#chart-supplier-title").text(chart1_title);
        
        supplier_chart = new frappe.Chart("#chart-supplier", {
            title: chart1_title,
            data: {
                labels: supplier_labels,
                datasets: [{ name: __("Pending Value"), values: supplier_values }]
            },
            type: "bar",
            height: 280,
            colors: ["#3182ce"],
            isNavigable: true,
            dataPointSelection: function(event) {
                if (event) {
                    let supplier_name = event.label || (event.index !== undefined ? top_suppliers[event.index]?.name : null);
                    if (supplier_name && supplier_name !== __("Others")) {
                        supplier_filter.set_value(supplier_name);
                        refresh_data();
                    }
                }
            }
        });
        
        let chartSupplierEl = document.getElementById("chart-supplier");
        if (chartSupplierEl) {
            if (chartSupplierEl._clickCaptureListener) {
                chartSupplierEl.removeEventListener("click", chartSupplierEl._clickCaptureListener, true);
            }
            
            chartSupplierEl.addEventListener('data-select', (e) => {
                if (e && e.label) {
                    if (e.label !== __("Others")) {
                        supplier_filter.set_value(e.label);
                        refresh_data();
                    }
                } else if (e && e.index !== undefined && top_suppliers[e.index]) {
                    let supplier_name = top_suppliers[e.index].name;
                    if (supplier_name && supplier_name !== __("Others")) {
                        supplier_filter.set_value(supplier_name);
                        refresh_data();
                    }
                }
            });

            chartSupplierEl._clickCaptureListener = function(e) {
                let $target = $(e.target);
                let text = $target.text().trim();
                if (text && text !== __("Others")) {
                    let match = top_suppliers.find(s => s.name === text);
                    if (match) {
                        supplier_filter.set_value(text);
                        refresh_data();
                        return;
                    }
                }
                
                let index_attr = $target.attr("data-index") || $target.attr("data-point-index") || $target.attr("index");
                if (!index_attr) {
                    let $closest = $target.closest(".bar, rect");
                    if ($closest.length) {
                        index_attr = $closest.attr("data-index") || $closest.attr("data-point-index") || $closest.attr("index");
                    }
                }
                
                if (index_attr !== undefined && index_attr !== null && index_attr !== "") {
                    let index = parseInt(index_attr);
                    if (!isNaN(index) && index >= 0 && top_suppliers[index]) {
                        let supplier_name = top_suppliers[index].name;
                        if (supplier_name && supplier_name !== __("Others")) {
                            supplier_filter.set_value(supplier_name);
                            refresh_data();
                            return;
                        }
                    }
                }
                
                let $bar = $target.closest(".bar, rect");
                if (!$bar.length) {
                    let $active_bar = $("#chart-supplier .bar.active, #chart-supplier rect.active");
                    if ($active_bar.length) $bar = $active_bar;
                }
                if (!$bar.length) return;
                
                let index = $("#chart-supplier .bar, #chart-supplier .dataset-units rect, #chart-supplier .bars rect").index($bar);
                
                if (index !== -1 && top_suppliers[index]) {
                    let supplier_name = top_suppliers[index].name;
                    if (supplier_name && supplier_name !== __("Others")) {
                        supplier_filter.set_value(supplier_name);
                        refresh_data();
                    }
                }
            };
            chartSupplierEl.addEventListener("click", chartSupplierEl._clickCaptureListener, true);
        }
        
        let chart2_title = "";
        let chart2_type = "donut";
        let chart2_colors = ["#e53e3e", "#319795"];
        let chart2_data = { labels: [], datasets: [] };
        let on_data_select_cb = null;

        if (status === "All Open") {
            chart2_title = __("Overdue vs Pending Items");
            $("#chart-status-title").text(chart2_title);
            $("#chart-status").empty();

            let overdue_count = data.filter(row => row.is_overdue).length;
            let pending_count = data.length - overdue_count;
            let total = overdue_count + pending_count || 1;
            let overdue_pct = Math.round((overdue_count / total) * 100);
            let pending_pct = 100 - overdue_pct;

            $("#chart-status").html(`
                <div class="stat-ring-card">
                    <div class="stat-ring-item clickable" id="stat-overdue-click" style="cursor:pointer; flex: 1; text-align: right; padding-right: 20px;">
                        <div class="stat-split-label">Overdue</div>
                        <div class="stat-split-num" style="color:#e53e3e; font-size: 32px; font-weight: 700;">${overdue_count}</div>
                        <div class="stat-split-pct" style="color:#e53e3e; font-size: 11px; font-weight: 600; text-transform: uppercase;">${overdue_pct}% of total</div>
                    </div>
                    
                    <div class="stat-ring-wrapper">
                        <svg width="110" height="110" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="50" fill="transparent" stroke="#e2e8f0" stroke-width="10"/>
                            <circle cx="60" cy="60" r="50" fill="transparent" stroke="#319795" stroke-width="10"/>
                            <circle cx="60" cy="60" r="50" fill="transparent" stroke="#e53e3e" stroke-width="10"
                                    stroke-dasharray="314" stroke-dashoffset="${314 - (314 * overdue_pct) / 100}"
                                    stroke-linecap="round" transform="rotate(-90 60 60)"/>
                        </svg>
                        <div class="stat-ring-center">
                            <span class="stat-ring-percent">${overdue_pct}%</span>
                            <span class="stat-ring-label">Overdue</span>
                        </div>
                    </div>
                    
                    <div class="stat-ring-item clickable" id="stat-pending-click" style="cursor:pointer; flex: 1; text-align: left; padding-left: 20px;">
                        <div class="stat-split-label">On Track</div>
                        <div class="stat-split-num" style="color:#319795; font-size: 32px; font-weight: 700;">${pending_count}</div>
                        <div class="stat-split-pct" style="color:#319795; font-size: 11px; font-weight: 600; text-transform: uppercase;">${pending_pct}% of total</div>
                    </div>
                </div>
                <div class="stat-split-total" style="margin-top: 10px;">Total: ${total} items</div>
            `);

            $("#stat-overdue-click").on("click", function() {
                status_filter.set_value("Overdue Only");
                refresh_data();
            });
            $("#stat-pending-click").on("click", function() {
                status_filter.set_value("Pending Only");
                refresh_data();
            });
        } else if (status === "Pending Only") {
            chart2_title = __("Expected Delivery Schedule (by Month)");
            chart2_type = "bar";
            chart2_colors = ["#319795"];
            
            let month_sums = {};
            data.forEach(row => {
                let month = row.required_date ? row.required_date.substring(0, 7) : "Unknown";
                month_sums[month] = (month_sums[month] || 0) + row.outstanding_amount;
            });
            
            sorted_months = Object.keys(month_sums).sort();
            let month_labels = sorted_months.map(m => {
                if (m === "Unknown") return m;
                let parts = m.split("-");
                let date = new Date(parts[0], parts[1] - 1, 1);
                return date.toLocaleString('default', { month: 'short', year: 'numeric' });
            });
            let month_values = sorted_months.map(m => Math.round(month_sums[m]));
            
            chart2_data = {
                labels: month_labels,
                datasets: [{ name: __("Pending Value"), values: month_values }]
            };
            
            on_data_select_cb = function(event) {
                if (event) {
                    let clicked_month = (event.index !== undefined ? sorted_months[event.index] : null) || event.label;
                    if (clicked_month && clicked_month !== "Unknown" && clicked_month.includes("-")) {
                        let parts = clicked_month.split("-");
                        let year = parseInt(parts[0]);
                        let month = parseInt(parts[1]);
                        
                        let start_date = `${year}-${String(month).padStart(2, '0')}-01`;
                        let last_day = new Date(year, month, 0).getDate();
                        let end_date = `${year}-${String(month).padStart(2, '0')}-${String(last_day).padStart(2, '0')}`;
                        
                        from_date_filter.set_value(start_date);
                        to_date_filter.set_value(end_date);
                        refresh_data();
                    }
                }
            };
        } 
        else if (status === "Overdue Only") {
            chart2_title = __("Overdue Value by Item");
            chart2_type = "bar";
            chart2_colors = ["#e53e3e"];
            
            let item_sums = {};
            data.forEach(row => {
                item_sums[row.item_code] = (item_sums[row.item_code] || 0) + row.outstanding_amount;
            });
            
            sorted_items = Object.keys(item_sums)
                .map(item => ({ name: item, value: item_sums[item] }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 5);
                
            chart2_data = {
                labels: sorted_items.map(i => i.name),
                datasets: [{ name: __("Overdue Value"), values: sorted_items.map(i => Math.round(i.value)) }]
            };
            
            on_data_select_cb = function(event) {
                if (event && event.index !== undefined) {
                    let clicked_item = sorted_items[event.index];
                    if (clicked_item) {
                        frappe.set_route("Form", "Item", clicked_item.name);
                    }
                }
            };
        }

        if (status !== "All Open") {
            $("#chart-status-title").text(chart2_title);
            status_chart = new frappe.Chart("#chart-status", {
                title: chart2_title,
                data: chart2_data,
                type: chart2_type,
                height: 280,
                colors: chart2_colors,
                dataPointSelection: on_data_select_cb
            });
        }
        
        let chartStatusEl = document.getElementById("chart-status");
        if (chartStatusEl) {
            if (chartStatusEl._clickCaptureListener) {
                chartStatusEl.removeEventListener("click", chartStatusEl._clickCaptureListener, true);
            }
            chartStatusEl._clickCaptureListener = function(e) {
                let $target = $(e.target);
                
                let $el = $target.closest("rect, path, .active");
                if ($el.length === 0 || (!$el.hasClass("bar") && !$el.hasClass("pie-slice") && !$el.hasClass("donut-path") && $el.prop("tagName").toLowerCase() !== "path")) {
                    let $active_bar = $("#chart-status .bar.active, #chart-status rect.active");
                    let $active_slice = $("#chart-status .pie-slice.active, #chart-status .donut-path.active, #chart-status path.active");
                    if ($active_bar.length) $el = $active_bar;
                    else if ($active_slice.length) $el = $active_slice;
                }
                
                if (!$el.length) return;
                
                let index = -1;
                let tagName = $el.prop("tagName").toLowerCase();
                
                if (tagName === "path") {
                    let $slice = $el.closest(".pie-slice, .donut-path, path");
                    index = $("#chart-status .pie-slice, #chart-status .donut-path, #chart-status .pie-slices path, #chart-status .slices path").index($slice);
                } else if (tagName === "rect") {
                    let $bar = $el.closest(".bar, rect");
                    index = $("#chart-status .bar, #chart-status .dataset-units rect, #chart-status .bars rect").index($bar);
                }
                
                if (index !== -1) {
                    if (status === "All Open") {
                        if (index === 0) {
                            status_filter.set_value("Overdue Only");
                            refresh_data();
                        } else if (index === 1) {
                            status_filter.set_value("Pending Only");
                            refresh_data();
                        }
                    } else if (status === "Pending Only") {
                        let clicked_month = sorted_months[index];
                        if (clicked_month && clicked_month !== "Unknown") {
                            let parts = clicked_month.split("-");
                            let year = parseInt(parts[0]);
                            let month = parseInt(parts[1]);
                            let start_date = `${year}-${String(month).padStart(2, '0')}-01`;
                            let last_day = new Date(year, month, 0).getDate();
                            let end_date = `${year}-${String(month).padStart(2, '0')}-${String(last_day).padStart(2, '0')}`;
                            from_date_filter.set_value(start_date);
                            to_date_filter.set_value(end_date);
                            refresh_data();
                        }
                    } else if (status === "Overdue Only") {
                        let clicked_item = sorted_items[index];
                        if (clicked_item) {
                            frappe.set_route("Form", "Item", clicked_item.name);
                        }
                    }
                }
            };
            chartStatusEl.addEventListener("click", chartStatusEl._clickCaptureListener, true);
        }

        let unique_pos = {};
        data.forEach(row => {
            if (row.po_no && unique_pos[row.po_no] === undefined) {
                unique_pos[row.po_no] = row.ageing_days || 0;
            }
        });

        let ageing_buckets = {
            "0-15 Days": 0,
            "15-30 Days": 0,
            "30-45 Days": 0,
            "> 45 Days": 0
        };
        Object.values(unique_pos).forEach(days => {
            if (days <= 15) {
                ageing_buckets["0-15 Days"]++;
            } else if (days <= 30) {
                ageing_buckets["15-30 Days"]++;
            } else if (days <= 45) {
                ageing_buckets["30-45 Days"]++;
            } else {
                ageing_buckets["> 45 Days"]++;
            }
        });

        let ageing_labels = ["0-15 Days", "15-30 Days", "30-45 Days", "> 45 Days"];
        let ageing_values = ageing_labels.map(l => ageing_buckets[l]);

        let total_pos = Object.keys(unique_pos).length || 1;
        let pct_0_15 = Math.round((ageing_buckets["0-15 Days"] / total_pos) * 100);
        let pct_15_30 = Math.round((ageing_buckets["15-30 Days"] / total_pos) * 100);
        let pct_30_45 = Math.round((ageing_buckets["30-45 Days"] / total_pos) * 100);
        let pct_gt_45 = Math.max(0, 100 - pct_0_15 - pct_15_30 - pct_30_45);

        $("#chart-ageing").empty().html(`
            <div class="stat-split-card">
                <div class="ageing-split-row">
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-ageing-0-15">
                        <div class="stat-split-dot" style="background:#2f855a;"></div>
                        <div class="stat-split-label">0-15 Days</div>
                        <div class="stat-split-num" style="color:#2f855a;">${ageing_buckets["0-15 Days"]}</div>
                        <div class="stat-split-pct">${pct_0_15}%</div>
                    </div>
                    <div class="stat-split-divider"></div>
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-ageing-15-30">
                        <div class="stat-split-dot" style="background:#ecc94b;"></div>
                        <div class="stat-split-label">15-30 Days</div>
                        <div class="stat-split-num" style="color:#ecc94b;">${ageing_buckets["15-30 Days"]}</div>
                        <div class="stat-split-pct">${pct_15_30}%</div>
                    </div>
                    <div class="stat-split-divider"></div>
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-ageing-30-45">
                        <div class="stat-split-dot" style="background:#dd6b20;"></div>
                        <div class="stat-split-label">30-45 Days</div>
                        <div class="stat-split-num" style="color:#dd6b20;">${ageing_buckets["30-45 Days"]}</div>
                        <div class="stat-split-pct">${pct_30_45}%</div>
                    </div>
                    <div class="stat-split-divider"></div>
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-ageing-gt-45">
                        <div class="stat-split-dot" style="background:#e53e3e;"></div>
                        <div class="stat-split-label">&gt; 45 Days</div>
                        <div class="stat-split-num" style="color:#e53e3e;">${ageing_buckets["> 45 Days"]}</div>
                        <div class="stat-split-pct">${pct_gt_45}%</div>
                    </div>
                </div>
                <div class="stat-split-bar">
                    <div style="width:${pct_0_15}%;background:#2f855a;height:100%;"></div>
                    <div style="width:${pct_15_30}%;background:#ecc94b;height:100%;"></div>
                    <div style="width:${pct_30_45}%;background:#dd6b20;height:100%;"></div>
                    <div style="width:${pct_gt_45}%;background:#e53e3e;height:100%;"></div>
                </div>
                <div class="stat-split-total">Total: ${Object.keys(unique_pos).length} POs</div>
            </div>
        `);

        $("#stat-ageing-0-15").on("click", () => { current_ageing_filter = "0-15 Days"; sort_and_render(); });
        $("#stat-ageing-15-30").on("click", () => { current_ageing_filter = "15-30 Days"; sort_and_render(); });
        $("#stat-ageing-30-45").on("click", () => { current_ageing_filter = "30-45 Days"; sort_and_render(); });
        $("#stat-ageing-gt-45").on("click", () => { current_ageing_filter = "> 45 Days"; sort_and_render(); });

        let billing_buckets = {
            "Not Billed": 0.0,
            "Partially Billed": 0.0,
            "Fully Billed": 0.0
        };
        data.forEach(row => {
            let billed = row.billed_qty || 0;
            let ordered = row.ordered_qty || 0;
            let val = row.pending_bill_val || 0;
            if (billed === 0) {
                billing_buckets["Not Billed"] += val;
            } else if (billed >= ordered) {
                billing_buckets["Fully Billed"] += val;
            } else {
                billing_buckets["Partially Billed"] += val;
            }
        });

        let billing_total = Object.values(billing_buckets).reduce((a,b) => a+b, 0) || 1;
        let b_not = billing_buckets["Not Billed"];
        let b_part = billing_buckets["Partially Billed"];
        let b_full = billing_buckets["Fully Billed"];
        let pct_not  = Math.round((b_not / billing_total) * 100);
        let pct_part = Math.round((b_part / billing_total) * 100);
        let pct_full = 100 - pct_not - pct_part;

        $("#chart-billing-title").text("Billing Status (Pending Bill Value)");
        $("#chart-billing").empty().html(`
            <div class="stat-split-card">
                <div class="stat-split-row" style="grid-template-columns: 1fr 1px 1fr 1px 1fr;">
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-bill-not">
                        <div class="stat-split-dot" style="background:#e53e3e;"></div>
                        <div class="stat-split-label">Not Billed</div>
                        <div class="stat-split-num" style="color:#e53e3e;font-size:15px;">${format_currency(b_not)}</div>
                        <div class="stat-split-pct">${pct_not}%</div>
                    </div>
                    <div class="stat-split-divider"></div>
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-bill-part">
                        <div class="stat-split-dot" style="background:#ecc94b;"></div>
                        <div class="stat-split-label">Partial</div>
                        <div class="stat-split-num" style="color:#b7791f;font-size:15px;">${format_currency(b_part)}</div>
                        <div class="stat-split-pct">${pct_part}%</div>
                    </div>
                    <div class="stat-split-divider"></div>
                    <div class="stat-split-item clickable" style="cursor:pointer;" id="stat-bill-full">
                        <div class="stat-split-dot" style="background:#2f855a;"></div>
                        <div class="stat-split-label">Fully Billed</div>
                        <div class="stat-split-num" style="color:#2f855a;font-size:15px;">${format_currency(b_full)}</div>
                        <div class="stat-split-pct">${pct_full}%</div>
                    </div>
                </div>
                <div class="stat-split-bar">
                    <div style="width:${pct_not}%;background:#e53e3e;height:100%;border-radius:4px 0 0 4px;"></div>
                    <div style="width:${pct_part}%;background:#ecc94b;height:100%;"></div>
                    <div style="width:${pct_full}%;background:#2f855a;height:100%;border-radius:0 4px 4px 0;"></div>
                </div>
            </div>
        `);

        $("#stat-bill-not").on("click", () => { current_billing_filter = "Not Billed"; sort_and_render(); });
        $("#stat-bill-part").on("click", () => { current_billing_filter = "Partially Billed"; sort_and_render(); });
        $("#stat-bill-full").on("click", () => { current_billing_filter = "Fully Billed"; sort_and_render(); });
    }
    
    function sort_and_render() {
        po_current_page = 1;
        let search_text = $("#po-search-input").val() ? $("#po-search-input").val().toLowerCase() : "";
        let display_data = report_data.filter(row => {
            return (
                row.po_no.toLowerCase().includes(search_text) ||
                row.supplier.toLowerCase().includes(search_text) ||
                row.item_code.toLowerCase().includes(search_text) ||
                row.item_name.toLowerCase().includes(search_text)
            );
        });

        if (current_ageing_filter) {
            $("#active-ageing-text").text(__("Ageing: ") + current_ageing_filter);
            $("#active-ageing-badge").show();
            display_data = display_data.filter(row => {
                let days = row.ageing_days || 0;
                if (current_ageing_filter === "0-15 Days") return days <= 15;
                if (current_ageing_filter === "15-30 Days") return days > 15 && days <= 30;
                if (current_ageing_filter === "30-45 Days") return days > 30 && days <= 45;
                if (current_ageing_filter === "> 45 Days") return days > 45;
                return true;
            });
        } else {
            $("#active-ageing-badge").hide();
        }

        if (current_billing_filter) {
            $("#active-billing-text").text(__("Billing: ") + current_billing_filter);
            $("#active-billing-badge").show();
            display_data = display_data.filter(row => {
                let billed = row.billed_qty || 0;
                let ordered = row.ordered_qty || 0;
                if (current_billing_filter === "Not Billed") return billed === 0;
                if (current_billing_filter === "Partially Billed") return billed > 0 && billed < ordered;
                if (current_billing_filter === "Fully Billed") return billed >= ordered;
                return true;
            });
        } else {
            $("#active-billing-badge").hide();
        }

        display_data.sort((a, b) => {
            let valA = a[current_sort.key];
            let valB = b[current_sort.key];
            if (valA === undefined || valA === null) valA = "";
            if (valB === undefined || valB === null) valB = "";
            if (typeof valA === "string") valA = valA.toLowerCase();
            if (typeof valB === "string") valB = valB.toLowerCase();
            
            if (valA < valB) return current_sort.asc ? -1 : 1;
            if (valA > valB) return current_sort.asc ? 1 : -1;
            return 0;
        });

        render_table(display_data);
    }

    function render_table(filtered_table_data) {
        let tbody = $("#po-table-body");
        tbody.empty();
        
        let total_count = filtered_table_data.length;
        $("#results-count").text(__("Showing ") + total_count + __(" items"));

        if (total_count === 0) {
            tbody.append(`<tr><td colspan="14" class="text-center text-muted">${__("No matching records found")}</td></tr>`);
            render_pagination("#po-table", 0, 1, po_page_size, () => {}, () => {});
            return;
        }

        let start_idx = (po_current_page - 1) * po_page_size;
        let end_idx = Math.min(start_idx + po_page_size, total_count);
        let page_data = filtered_table_data.slice(start_idx, end_idx);

        page_data.forEach(row => {
            let row_class = row.is_overdue ? "row-overdue" : "";
            tbody.append(`
                <tr class="${row_class}">
                    <td><a class="document-link po-link" data-po="${row.po_no}">${row.po_no}</a></td>
                    <td>${frappe.datetime.str_to_user(row.po_date)}</td>
                    <td class="text-right ${row.ageing_days > 45 ? 'text-danger font-weight-bold' : ''}">
                        ${row.ageing_days}
                    </td>
                    <td>
                        <div class="date-container">
                            <span>${frappe.datetime.str_to_user(row.required_date)}</span>
                            ${row.is_overdue ? '<span class="badge badge-danger">Overdue</span>' : ''}
                        </div>
                    </td>
                    <td><a class="document-link supplier-link" data-supplier="${row.supplier}">${row.supplier}</a></td>
                    <td><a class="document-link item-link" data-item="${row.item_code}">${row.item_code}</a></td>
                    <td>${row.item_name}</td>
                    <td class="text-right">${fmt_float(row.ordered_qty)}</td>
                    <td class="text-right font-weight-bold ${row.outstanding_qty > 0 ? 'text-primary' : ''}">
                        ${fmt_float(row.outstanding_qty)}
                    </td>
                    <td class="text-right">${fmt_float(row.billed_qty)}</td>
                    <td class="text-right font-weight-bold ${row.pending_billed_qty > 0 ? 'text-warning' : ''}">
                        ${fmt_float(row.pending_billed_qty)}
                    </td>
                    <td class="text-right font-weight-bold ${row.pending_bill_val > 0 ? 'text-warning' : ''}">
                        ${format_currency(row.pending_bill_val || 0)}
                    </td>
                    <td class="text-right">${format_currency(row.rate)}</td>
                    <td class="text-right font-weight-bold">${format_currency(row.amount)}</td>
                </tr>
            `);
        });
        
        render_pagination(
            "#po-table", 
            total_count, 
            po_current_page, 
            po_page_size, 
            (p) => { po_current_page = p; render_table(filtered_table_data); },
            (s) => { po_page_size = s; po_current_page = 1; render_table(filtered_table_data); }
        );
    }
    
    // Bind table headers for sorting
    $("#po-table th").on("click", function() {
        let key = $(this).attr("data-sort");
        if (!key) return;
        
        if (current_sort.key === key) {
            current_sort.asc = !current_sort.asc;
        } else {
            current_sort.key = key;
            current_sort.asc = true;
        }
        
        $("#po-table th i").removeClass("fa-sort-asc fa-sort-desc").addClass("fa-sort");
        let icon = $(this).find("i");
        icon.removeClass("fa-sort");
        icon.addClass(current_sort.asc ? "fa-sort-asc" : "fa-sort-desc");
        
        sort_and_render();
    });
    
    $("#po-search-input").on("keyup", function() {
        sort_and_render();
    });

    main_container.on("click", ".po-link", function() {
        frappe.set_route("Form", "Purchase Order", $(this).attr("data-po"));
    });
    main_container.on("click", ".supplier-link", function() {
        frappe.set_route("Form", "Supplier", $(this).attr("data-supplier"));
    });
    main_container.on("click", ".item-link", function() {
        frappe.set_route("Form", "Item", $(this).attr("data-item"));
    });
    main_container.on("click", "#active-ageing-badge", function() {
        current_ageing_filter = null;
        sort_and_render();
    });
    main_container.on("click", "#active-billing-badge", function() {
        current_billing_filter = null;
        sort_and_render();
    });
    
    function get_currency_symbol(currency) {
        if (!currency) {
            currency = "INR";
        }
        try {
            return frappe.boot.sysdefaults.currency_symbol ||
                   (frappe.model.get_value(":Currency", currency, "symbol")) ||
                   (currency === "INR" ? "₹" : currency);
        } catch(e) {
            return currency === "INR" ? "₹" : currency;
        }
    }

    function format_currency(val, currency) {
        let sym = get_currency_symbol(currency);
        let num = parseFloat(val || 0).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return sym + "\u00A0" + num;
    }

    function format_currency_html(val, currency) {
        let sym = get_currency_symbol(currency);
        let num = parseFloat(val || 0).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return `<span class="kpi-sym">${sym}</span><span>${num}</span>`;
    }

    function fmt_float(val) {
        return parseFloat(val || 0).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    
    function render_pagination(table_selector, total_items, current_page, page_size, on_page_change, on_size_change) {
        let container = $(table_selector).parent();
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
            on_size_change(parseInt($(this).val()));
        });
        
        pagination_area.append(size_selector);
        
        let buttons_container = $('<div class="pagination-buttons" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;"></div>');
        
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
                    on_page_change(page_num);
                });
            }
            buttons_container.append(btn);
        }
        
        add_button('<i class="fa fa-angle-left"></i>', current_page - 1, false, current_page === 1);
        
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
        
        add_button('<i class="fa fa-angle-right"></i>', current_page + 1, false, current_page === total_pages);
        
        pagination_area.append(buttons_container);
    }

    function export_to_csv() {
        let csv = [];
        let headers = ["PO Number", "PO Date", "Ageing (Days)", "Expected Date", "Supplier", "Item Code", "Item Name", "Ordered Qty", "Pending Qty", "Billed Qty", "Pending Bill Qty", "Pending Bill Value", "Rate", "Amount"];
        csv.push(headers.join(","));
        
        report_data.forEach(row => {
            let line = [
                `"${row.po_no}"`,
                `"${row.po_date}"`,
                row.ageing_days,
                `"${row.required_date}"`,
                `"${row.supplier.replace(/"/g, '""')}"`,
                `"${row.item_code}"`,
                `"${row.item_name.replace(/"/g, '""')}"`,
                row.ordered_qty,
                row.outstanding_qty,
                row.billed_qty,
                row.pending_billed_qty,
                (row.pending_bill_val || 0).toFixed(2),
                row.rate,
                row.amount
            ];
            csv.push(line.join(","));
        });
        
        let csv_string = csv.join("\n");
        let filename = `open_purchase_orders_${frappe.datetime.get_today()}.csv`;
        let link = document.createElement("a");
        link.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csv_string));
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Styles injection
    function inject_styles() {
        if ($("#purchase-analytics-style").length) return;
        
        $(`<style id="purchase-analytics-style">
            .purchase-analytics-dashboard {
                padding: 15px 0;
            }
            .kpi-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 15px;
                margin-bottom: 25px;
            }
            .charts-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                margin-bottom: 25px;
            }
            @media (max-width: 900px) {
                .charts-grid {
                    grid-template-columns: 1fr;
                }
            }
            .chart-card {
                background: var(--card-bg, #fff);
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 8px;
                padding: 15px 20px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .chart-header {
                margin-bottom: 15px;
            }
            .chart-title {
                font-size: 13px;
                color: var(--text-color, #2d3748);
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .chart-container {
                height: 280px;
            }
            .chart-container svg text {
                font-size: 10px !important;
            }
            .chart-container svg text.donut-value,
            .chart-container svg text.donut-label {
                font-size: 18px !important;
            }
            .chart-container svg rect, 
            .chart-container svg path {
                cursor: pointer;
                transition: opacity 0.2s;
            }
            .chart-container svg rect:hover, 
            .chart-container svg path:hover {
                opacity: 0.85;
            }
            .kpi-card {
                background: var(--card-bg, #fff);
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 8px;
                padding: 15px 20px;
                display: flex;
                align-items: center;
                gap: 15px;
                transition: transform 0.2s, box-shadow 0.2s;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .kpi-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 6px rgba(0,0,0,0.08);
            }
            .kpi-icon {
                font-size: 28px;
                width: 50px;
                height: 50px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: var(--bg-light-gray, #f7fafc);
            }
            .kpi-info {
                display: flex;
                flex-direction: column;
            }
            .kpi-label {
                font-size: 12px;
                color: var(--text-muted, #718096);
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .kpi-val {
                margin: 4px 0 0 0;
                font-size: 20px;
                font-weight: 700;
                color: var(--text-color, #2d3748);
                white-space: nowrap;
                display: flex;
                align-items: baseline;
                gap: 3px;
            }
            .kpi-sym {
                font-size: 14px;
                font-weight: 600;
                color: var(--text-muted, #718096);
            }
            .kpi-danger-pulse {
                border-color: #feb2b2;
                box-shadow: 0 0 0 2px rgba(245, 101, 101, 0.2);
                animation: dangerPulse 2s infinite;
            }
            @keyframes dangerPulse {
                0% {
                    box-shadow: 0 0 0 0px rgba(245, 101, 101, 0.4);
                }
                70% {
                    box-shadow: 0 0 0 6px rgba(245, 101, 101, 0);
                }
                100% {
                    box-shadow: 0 0 0 0px rgba(245, 101, 101, 0);
                }
            }
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
            .po-search-input {
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
            .results-count {
                font-size: 13px;
                color: var(--text-muted, #718096);
                font-weight: 500;
            }
            .table-container {
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 8px;
                overflow-x: auto;
                overflow-y: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                background: #fff;
            }
            .po-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .po-table th {
                background: var(--bg-light-gray, #f7fafc);
                padding: 10px 12px;
                font-weight: 600;
                text-align: left;
                color: var(--text-muted, #4a5568);
                border-bottom: 1px solid var(--border-color, #e2e8f0);
                cursor: pointer;
                user-select: none;
                transition: background-color 0.2s;
                white-space: nowrap;
            }
            .po-table th:hover {
                background: #edf2f7;
            }
            .po-table th i {
                font-size: 11px;
                margin-left: 5px;
                color: #cbd5e0;
            }
            .po-table td {
                padding: 10px 12px;
                border-bottom: 1px solid var(--border-color, #edf2f7);
                vertical-align: middle;
                white-space: nowrap;
            }
            .po-table tbody tr:hover {
                background: #f7fafc;
            }
            .row-overdue {
                background-color: #fffaf0;
            }
            .row-overdue:hover {
                background-color: #fff5f5 !important;
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
            .date-container {
                display: flex;
                align-items: center;
                gap: 8px;
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
            .badge-success {
                background-color: #c6f6d5;
                color: #22543d;
            }
            .font-weight-bold {
                font-weight: 600;
            }
            .stat-ring-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                height: 100%;
                padding: 10px 0;
            }
            .stat-ring-item {
                display: flex;
                flex-direction: column;
                justify-content: center;
                height: 80px;
                border-radius: 8px;
                transition: background 0.2s;
                padding: 10px;
            }
            .stat-ring-item:hover {
                background: var(--bg-light-gray, #f7fafc);
            }
            .stat-ring-wrapper {
                position: relative;
                width: 110px;
                height: 110px;
                flex-shrink: 0;
            }
            .stat-ring-center {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
            }
            .stat-ring-percent {
                font-size: 22px;
                font-weight: 700;
                color: #e53e3e;
                line-height: 1;
            }
            .stat-ring-label {
                font-size: 9px;
                font-weight: 600;
                color: var(--text-muted, #718096);
                text-transform: uppercase;
                margin-top: 2px;
                letter-spacing: 0.5px;
            }
            .stat-split-card {
                display: flex;
                flex-direction: column;
                gap: 16px;
                padding: 10px 0;
                height: 100%;
                justify-content: center;
            }
            .stat-split-row {
                display: grid;
                grid-template-columns: 1fr 1px 1fr;
                gap: 0;
            }
            .ageing-split-row {
                display: grid;
                grid-template-columns: 1fr 1px 1fr 1px 1fr 1px 1fr;
                gap: 0;
            }
            .stat-split-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 6px;
                padding: 12px 8px;
                border-radius: 8px;
                transition: background 0.2s;
            }
            .stat-split-item:hover {
                background: var(--bg-light-gray, #f7fafc);
            }
            .stat-split-dot {
                width: 12px;
                height: 12px;
                border-radius: 50%;
            }
            .stat-split-label {
                font-size: 11px;
                font-weight: 600;
                color: var(--text-muted, #718096);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .stat-split-num {
                font-size: 28px;
                font-weight: 700;
                line-height: 1;
            }
            .stat-split-pct {
                font-size: 12px;
                color: var(--text-muted, #a0aec0);
                font-weight: 500;
            }
            .stat-split-divider {
                background: var(--border-color, #e2e8f0);
                width: 1px;
                margin: 10px 0;
            }
            .stat-split-bar {
                display: flex;
                height: 10px;
                border-radius: 5px;
                overflow: hidden;
                margin: 0 4px;
            }
            .stat-split-total {
                text-align: center;
                font-size: 12px;
                color: var(--text-muted, #a0aec0);
            }
            .text-success {
                color: #2f855a !important;
            }
            .text-danger {
                color: #e53e3e !important;
            }
        </style>`).appendTo("head");
    }
    
    // Initial load
    refresh_data();
};
