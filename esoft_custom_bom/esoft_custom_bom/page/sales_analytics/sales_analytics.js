// Copyright (c) 2026, Esoft and contributors
// Sales Analytics Dashboard — Phase 2 & 3 Frontend

frappe.pages["sales-analytics"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Sales Analytics Dashboard"),
        single_column: true
    });

    inject_sales_styles();

    // ── Filter bar fields ──────────────────────────
    let f_from = page.add_field({ fieldname:"from_date", label:__("From Date"), fieldtype:"Date", change: () => apply_filters() });
    let f_to   = page.add_field({ fieldname:"to_date",   label:__("To Date"),   fieldtype:"Date", change: () => apply_filters() });
    let f_cust = page.add_field({ fieldname:"customer",  label:__("Customer"),  fieldtype:"Link", options:"Customer", change: () => apply_filters() });
    let f_cg   = page.add_field({ fieldname:"customer_group",label:__("Customer Group"),fieldtype:"Link", options:"Customer Group", change: () => apply_filters() });
    let f_terr = page.add_field({ fieldname:"territory", label:__("Territory"), fieldtype:"Link", options:"Territory", change: () => apply_filters() });
    let f_ig   = page.add_field({ fieldname:"item_group", label:__("Item Group"), fieldtype:"Link", options:"Item Group", change: () => apply_filters() });
    let f_sp   = page.add_field({ fieldname:"sales_person", label:__("Sales Person"), fieldtype:"Link", options:"Sales Person", change: () => apply_filters() });

    page.set_primary_action(__("Refresh Now"), () => refresh_all(), "refresh");
    page.set_secondary_action(__("Reset Filters"), () => reset_filters(), "close");

    // ── Main container ────────────────────────────────────────────────────
    var $wrap = $('<div class="sa-dash"></div>').appendTo(page.main);

    $wrap.html(`
        <div class="sa-last-updated">
            <span>Last updated: <strong id="sa-last-ts">—</strong></span>
            <span id="sa-active-filters" class="sa-active-filter-bar"></span>
        </div>

        <div class="sa-tabs">
            <div class="sa-tab active" id="tab-btn-overview" onclick="sa_switch_tab('overview')">Overview</div>
            <div class="sa-tab" id="tab-btn-fulfillment" onclick="sa_switch_tab('fulfillment')">Fulfillment</div>
            <div class="sa-tab" id="tab-btn-receivables" onclick="sa_switch_tab('receivables')">Receivables</div>
            <div class="sa-tab" id="tab-btn-activity" onclick="sa_switch_tab('activity')">Customer Activity</div>
        </div>

        <!-- ================= TAB 1: OVERVIEW ================= -->
        <div id="tab-content-overview" class="sa-tab-pane active">
            <!-- Row 1: KPIs -->
            <div class="sa-kpi-row" id="sa-overview-kpis">
                <div class="sa-kpi loading" id="okpi-rev"><div class="sa-kpi-icon">💰</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Total Revenue</div></div>
                <div class="sa-kpi loading" id="okpi-so"><div class="sa-kpi-icon">📝</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Total SO Value</div></div>
                <div class="sa-kpi loading" id="okpi-qty"><div class="sa-kpi-icon">📦</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Total Qty Sold</div></div>
                <div class="sa-kpi loading" id="okpi-orders"><div class="sa-kpi-icon">🛒</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Order Count</div></div>
                <div class="sa-kpi loading" id="okpi-inv"><div class="sa-kpi-icon">🧾</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Invoice Count</div></div>
                <div class="sa-kpi loading" id="okpi-aov"><div class="sa-kpi-icon">📈</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">AOV</div></div>
                <div class="sa-kpi loading" id="okpi-mom"><div class="sa-kpi-icon">🚀</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">MoM Growth</div></div>
            </div>

            <!-- Row 2: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Monthly Sales Trend (Booked vs Invoiced)</div>
                    <div id="chart-monthly-trend" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Revenue by Territory</div>
                    <div id="chart-rev-territory" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 3: Top N -->
            <div class="sa-row-3col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Top 5 Items by Revenue</div>
                    <div id="chart-top-items" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Top 5 Customers by Revenue</div>
                    <div id="chart-top-customers" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Revenue by Item Group</div>
                    <div id="chart-rev-item-group" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 4: Table -->
            <div class="sa-chart-card sa-table-card">
                <div class="sa-chart-title" style="display:flex;justify-content:space-between;">
                    <span>Recent Sales Orders</span>
                    <span id="overview-filter-badge" class="sa-badge-blue" style="display:none"></span>
                </div>
                <div class="sa-table-wrap"><table class="sa-table" id="tbl-overview">
                    <thead><tr><th>Order ID</th><th>Date</th><th>Customer</th><th>Territory</th><th>Status</th><th class="num">Amount</th><th class="num">Qty</th></tr></thead>
                    <tbody id="tbl-overview-body"><tr><td colspan="7" class="sa-empty">Loading…</td></tr></tbody>
                </table></div>
            </div>
        </div>

        <!-- ================= TAB 2: FULFILLMENT ================= -->
        <div id="tab-content-fulfillment" class="sa-tab-pane" style="display:none;">
            <!-- Row 1: KPIs -->
            <div class="sa-kpi-row" id="sa-fulfillment-kpis">
                <div class="sa-kpi loading" id="fkpi-pend"><div class="sa-kpi-icon">🕒</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Pending Delivery</div></div>
                <div class="sa-kpi loading" id="fkpi-part"><div class="sa-kpi-icon">⏳</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Partial Delivery</div></div>
                <div class="sa-kpi loading" id="fkpi-comp"><div class="sa-kpi-icon">✅</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Completed Delivery</div></div>
                <div class="sa-kpi loading danger" id="fkpi-over"><div class="sa-kpi-icon">⚠️</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Overdue Delivery</div></div>
                <div class="sa-kpi loading" id="fkpi-pinv"><div class="sa-kpi-icon">📝</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Pending Invoicing</div></div>
                <div class="sa-kpi loading" id="fkpi-val"><div class="sa-kpi-icon">💸</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Stuck Value</div></div>
            </div>

            <!-- Row 2: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Delivery Performance Trend (On-Time %)</div>
                    <div id="chart-delivery-trend" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Fulfillment Status Split</div>
                    <div id="chart-fulfillment-split" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 3: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Top Items (Ordered vs Delivered vs Invoiced)</div>
                    <div id="chart-ordered-delivered" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Top Overdue Value by Customer</div>
                    <div id="chart-overdue-customer" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 4: Expandable Table (Phase 3 Requirement) -->
            <div class="sa-chart-card sa-table-card">
                <div class="sa-chart-title" style="display:flex;justify-content:space-between;">
                    <span>Order Fulfillment Details (SO → DN → SI)</span>
                    <span id="fulfillment-filter-badge" class="sa-badge-blue" style="display:none"></span>
                </div>
                <div class="sa-table-wrap" id="drilldown-fulfillment">
                    <div class="sa-empty">Loading…</div>
                </div>
            </div>
        </div>

        <!-- ================= TAB 3: RECEIVABLES ================= -->
        <div id="tab-content-receivables" class="sa-tab-pane" style="display:none;">
            <!-- Row 1: KPIs -->
            <div class="sa-kpi-row" id="sa-receivables-kpis">
                <div class="sa-kpi loading" id="rkpi-tout"><div class="sa-kpi-icon">💰</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Total Outstanding</div></div>
                <div class="sa-kpi loading danger" id="rkpi-tover"><div class="sa-kpi-icon">🔴</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Total Overdue</div></div>
                <div class="sa-kpi loading" id="rkpi-tcur"><div class="sa-kpi-icon">🟢</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Current Amount</div></div>
                <div class="sa-kpi loading" id="rkpi-oic"><div class="sa-kpi-icon">📄</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Overdue Invoices</div></div>
                <div class="sa-kpi loading" id="rkpi-old"><div class="sa-kpi-icon">⏳</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Oldest (Days)</div></div>
            </div>

            <!-- Row 2: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Collections Trend (Invoiced vs Collected)</div>
                    <div id="chart-collections-trend" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Ageing Buckets</div>
                    <div id="chart-ageing-buckets" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 3: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Top 5 Customers by Outstanding</div>
                    <div id="chart-top-cust-out" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Outstanding by Territory</div>
                    <div id="chart-out-territory" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 4: Table -->
            <div class="sa-chart-card sa-table-card">
                <div class="sa-chart-title" style="display:flex;justify-content:space-between;">
                    <span>Receivables Ageing Details</span>
                    <span id="receivables-filter-badge" class="sa-badge-blue" style="display:none"></span>
                </div>
                <div class="sa-table-wrap"><table class="sa-table" id="tbl-receivables">
                    <thead><tr><th>Invoice No</th><th>Customer</th><th>Invoice Date</th><th>Due Date</th><th class="num">Invoice Amt</th><th class="num">Paid Amt</th><th class="num">Outstanding</th><th class="num">Days Overdue</th><th>Bucket</th></tr></thead>
                    <tbody id="tbl-receivables-body"><tr><td colspan="9" class="sa-empty">Loading…</td></tr></tbody>
                </table></div>
            </div>
        </div>

        <!-- ================= TAB 4: CUSTOMER ACTIVITY ================= -->
        <div id="tab-content-activity" class="sa-tab-pane" style="display:none;">
            <!-- Row 1: KPIs -->
            <div class="sa-kpi-row" id="sa-activity-kpis">
                <div class="sa-kpi loading" id="akpi-act"><div class="sa-kpi-icon">🟢</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Active Customers</div></div>
                <div class="sa-kpi loading warning" id="akpi-risk"><div class="sa-kpi-icon">🟡</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">At-Risk Customers</div></div>
                <div class="sa-kpi loading danger" id="akpi-dorm"><div class="sa-kpi-icon">🔴</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Dormant Customers</div></div>
                <div class="sa-kpi loading" id="akpi-rev"><div class="sa-kpi-icon">💰</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">Active Revenue</div></div>
                <div class="sa-kpi loading" id="akpi-new"><div class="sa-kpi-icon">🌟</div><div class="sa-kpi-val">—</div><div class="sa-kpi-label">New Customers</div></div>
            </div>

            <!-- Row 2: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">New Customer Acquisition Trend</div>
                    <div id="chart-new-cust-trend" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Customer Activity Split</div>
                    <div id="chart-activity-split" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 3: Charts -->
            <div class="sa-row-2col">
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Top 5 Dormant Customers by Historical Value</div>
                    <div id="chart-top-dormant" class="sa-chart-body"></div>
                </div>
                <div class="sa-chart-card">
                    <div class="sa-chart-title">Dormant Value by Customer Group</div>
                    <div id="chart-dormant-group" class="sa-chart-body"></div>
                </div>
            </div>

            <!-- Row 4: Table -->
            <div class="sa-chart-card sa-table-card">
                <div class="sa-chart-title" style="display:flex;justify-content:space-between;">
                    <span>Customer Activity Log</span>
                    <span id="activity-filter-badge" class="sa-badge-blue" style="display:none"></span>
                </div>
                <div class="sa-table-wrap"><table class="sa-table" id="tbl-activity">
                    <thead><tr><th>Customer</th><th>Territory</th><th>Group</th><th>Last Order Date</th><th class="num">Days Since Order</th><th class="num">Historical Value</th><th>Status</th></tr></thead>
                    <tbody id="tbl-activity-body"><tr><td colspan="7" class="sa-empty">Loading…</td></tr></tbody>
                </table></div>
            </div>
        </div>
    `);

    // ── State ─────────────────────────────────────────────────────────────
    let charts = {};
    let _filters = {};
    let current_tab = "overview";
    let _autoRefreshTimer = null;
    
    // Client-side table filters set by chart clicks
    let _table_filters = {
        overview: { territory: null, customer: null },
        fulfillment: { status: null, customer: null },
        receivables: { bucket: null, territory: null, customer: null },
        activity: { status: null, group: null, customer: null }
    };

    const API = "esoft_custom_bom.api.sales_analytics.";

    // ── Helpers ───────────────────────────────────────────────────────────
    function get_filters() {
        return {
            from_date: f_from.get_value(),
            to_date:   f_to.get_value(),
            customer:  f_cust.get_value(),
            customer_group: f_cg.get_value(),
            territory: f_terr.get_value(),
            item_group: f_ig.get_value(),
            sales_person: f_sp.get_value()
        };
    }

    function fmt_num(v, dec=0) {
        if (v === null || v === undefined) return "—";
        return parseFloat(v).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    function fmt_cur(v) {
        if (v === null || v === undefined) return "—";
        v = parseFloat(v);
        if (v >= 10000000) return (v/10000000).toFixed(2) + " Cr";
        if (v >= 100000) return (v/100000).toFixed(2) + " L";
        if (v >= 1000) return (v/1000).toFixed(1) + " K";
        return v.toFixed(0);
    }

    function destroy_chart(key) {
        if (charts[key]) { try { charts[key].destroy(); } catch(e) {} charts[key] = null; }
    }

    function set_loading(sel) { $(sel).html('<div class="sa-spinner"></div>'); }

    function apply_filters() {
        _filters = get_filters();
        _table_filters[current_tab] = {}; // clear client table filters for active tab
        refresh_tab(current_tab); 
        render_active_filter_badge();
        save_to_url();
    }

    function reset_filters() {
        f_from.set_value(""); f_to.set_value(""); f_cust.set_value("");
        f_cg.set_value(""); f_terr.set_value(""); f_ig.set_value(""); f_sp.set_value("");
        _table_filters = { overview:{}, fulfillment:{}, receivables:{}, activity:{} };
        apply_filters();
    }

    function render_active_filter_badge() {
        let active = Object.entries(_filters).filter(([,v]) => v).map(([k,v]) => `<span class="sa-filter-chip">${k.replace(/_/g,' ')}: <strong>${v}</strong></span>`).join("");
        $("#sa-active-filters").html(active);
    }

    function refresh_all() {
        _filters = get_filters();
        refresh_tab(current_tab);
        $("#sa-last-ts").text(frappe.datetime.now_time());
    }

    function refresh_tab(tab) {
        if (tab === "overview") load_overview();
        else if (tab === "fulfillment") load_fulfillment();
        else if (tab === "receivables") load_receivables();
        else if (tab === "activity") load_activity();
        
        apply_client_table_filter(tab);
    }

    function set_kpi(id, val, format_fn, cls="") {
        let $el = $("#"+id);
        $el.removeClass("loading danger warning success");
        if (cls) $el.addClass(cls);
        $el.find(".sa-kpi-val").text(format_fn ? format_fn(val) : val);
    }

    window.sa_switch_tab = function(tab) {
        $(".sa-tab").removeClass("active");
        $("#tab-btn-"+tab).addClass("active");
        $(".sa-tab-pane").hide();
        $("#tab-content-"+tab).show();
        current_tab = tab;
        save_to_url();
        refresh_tab(tab); 
    };

    // ── URL Persistence (Phase 3) ─────────────────────────────────────────
    function save_to_url() {
        let params = new URLSearchParams(window.location.search);
        Object.entries(_filters).forEach(([k,v]) => v ? params.set(k,v) : params.delete(k));
        params.set("tab", current_tab);
        history.replaceState(null,"",window.location.pathname+"?"+params.toString());
    }

    function load_from_url() {
        let p = new URLSearchParams(window.location.search);
        if (p.get("from_date"))       f_from.set_value(p.get("from_date"));
        if (p.get("to_date"))         f_to.set_value(p.get("to_date"));
        if (p.get("customer"))        f_cust.set_value(p.get("customer"));
        if (p.get("customer_group"))  f_cg.set_value(p.get("customer_group"));
        if (p.get("territory"))       f_terr.set_value(p.get("territory"));
        if (p.get("item_group"))      f_ig.set_value(p.get("item_group"));
        if (p.get("sales_person"))    f_sp.set_value(p.get("sales_person"));
        
        if (p.get("tab") && ["overview","fulfillment","receivables","activity"].includes(p.get("tab"))) {
            current_tab = p.get("tab");
        }
    }

    // ── Auto Refresh (Phase 3) ────────────────────────────────────────────
    function start_auto_refresh() {
        if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
        _autoRefreshTimer = setInterval(() => {
            if (document.hidden) return; // Use Page Visibility API implicitly
            if (["fulfillment", "receivables"].includes(current_tab)) {
                refresh_tab(current_tab);
                let ts = frappe.datetime.now_time();
                $("#sa-last-ts").text(ts);
                frappe.show_alert({ message: __(`Auto-refreshed ${current_tab} data at ${ts}`), indicator: "blue" }, 3);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    // ── Client-side Table Filtering (Phase 3) ─────────────────────────────
    function bind_chart_click(chart_id, tab, filter_key) {
        let el = document.getElementById(chart_id);
        if (el) el.addEventListener("click", () => {
            setTimeout(() => {
                let seg = el.querySelector(".legend-dataset-text.highlighted, path.active, .x.axis .tick.highlight text");
                if (!seg) return;
                let val = seg.textContent.trim();
                _table_filters[tab][filter_key] = (_table_filters[tab][filter_key] === val) ? null : val;
                apply_client_table_filter(tab);
            }, 100);
        });
    }

    function apply_client_table_filter(tab) {
        let tf = _table_filters[tab];
        let parts = Object.entries(tf).filter(([,v]) => v).map(([k,v]) => `${k}:${v}`);
        
        if (tab === "overview") {
            $("#tbl-overview-body tr").each(function() {
                let show = true;
                if (tf.territory && $(this).find("td:eq(3)").text().trim() !== tf.territory) show = false;
                if (tf.customer && $(this).find("td:eq(2)").text().trim() !== tf.customer) show = false;
                $(this).toggle(show);
            });
            $("#overview-filter-badge").text(parts.length ? `Filtered by ${parts.join(', ')}` : "").toggle(parts.length > 0);
        }
        else if (tab === "fulfillment") {
            $("#tbl-fulfillment-body tr.sa-dd-so").each(function() {
                let show = true;
                let status = $(this).find("td:eq(4)").text().trim();
                let customer = $(this).find("td:eq(1)").text().trim();
                if (tf.status && status !== tf.status && (tf.status==="Completed"?!["Completed","Closed"].includes(status):tf.status==="Partial"?!["Work In Progress","Partial"].includes(status):tf.status==="Pending"?!["Open"].includes(status):true)) show = false;
                if (tf.customer && customer !== tf.customer) show = false;
                $(this).toggle(show);
                // hide subtable if parent is hidden
                if(!show) $(this).next("tr").hide(); 
            });
            $("#fulfillment-filter-badge").text(parts.length ? `Filtered by ${parts.join(', ')}` : "").toggle(parts.length > 0);
        }
        else if (tab === "receivables") {
            $("#tbl-receivables-body tr").each(function() {
                let show = true;
                if (tf.bucket && $(this).find("td:eq(8)").text().trim() !== tf.bucket) show = false;
                if (tf.customer && $(this).find("td:eq(1)").text().trim() !== tf.customer) show = false;
                if (tf.territory && $(this).find("td:eq(8)").text().trim() !== tf.territory) show = false; // Note: territory isn't in table, so this filter might not work perfectly unless added to table row data
                $(this).toggle(show);
            });
            $("#receivables-filter-badge").text(parts.length ? `Filtered by ${parts.join(', ')}` : "").toggle(parts.length > 0);
        }
        else if (tab === "activity") {
            $("#tbl-activity-body tr").each(function() {
                let show = true;
                if (tf.status && $(this).find("td:eq(6)").text().trim() !== tf.status) show = false;
                if (tf.group && $(this).find("td:eq(2)").text().trim() !== tf.group) show = false;
                if (tf.customer && $(this).find("td:eq(0)").text().trim() !== tf.customer) show = false;
                $(this).toggle(show);
            });
            $("#activity-filter-badge").text(parts.length ? `Filtered by ${parts.join(', ')}` : "").toggle(parts.length > 0);
        }
    }


    // ================= TAB 1: OVERVIEW LOADERS ================= //
    function load_overview() {
        ["okpi-rev","okpi-so","okpi-qty","okpi-orders","okpi-inv","okpi-aov","okpi-mom"].forEach(id => $("#"+id).addClass("loading"));
        
        frappe.call({ method: API+"get_overview_kpis", args: _filters, callback: r => {
            let d = r.message || {};
            set_kpi("okpi-rev", d.total_revenue, fmt_cur);
            set_kpi("okpi-so", d.total_so_value, fmt_cur);
            set_kpi("okpi-qty", d.total_qty_sold, v => fmt_num(v,0));
            set_kpi("okpi-orders", d.order_count, v => fmt_num(v,0));
            set_kpi("okpi-inv", d.invoice_count, v => fmt_num(v,0));
            set_kpi("okpi-aov", d.aov, fmt_cur);
            set_kpi("okpi-mom", d.mom_growth, v => fmt_num(v,1)+"%", d.mom_growth < 0 ? "danger" : (d.mom_growth > 0 ? "success" : ""));
        }});

        set_loading("#chart-monthly-trend");
        frappe.call({ method: API+"get_chart_monthly_sales_trend", args: _filters, callback: r => {
            destroy_chart("o_trend"); $("#chart-monthly-trend").empty();
            let d = r.message || {booked:[], invoiced:[]};
            let labels = [...new Set([...d.booked.map(x=>x.month), ...d.invoiced.map(x=>x.month)])].sort();
            if(!labels.length) { $("#chart-monthly-trend").html('<div class="sa-empty">No data</div>'); return; }
            let b_vals = labels.map(l => { let o = d.booked.find(x=>x.month===l); return o ? o.value : 0; });
            let i_vals = labels.map(l => { let o = d.invoiced.find(x=>x.month===l); return o ? o.value : 0; });
            charts.o_trend = new frappe.Chart("#chart-monthly-trend", {
                data: { labels: labels, datasets: [{name:"Booked", values:b_vals}, {name:"Invoiced", values:i_vals}] },
                type: "line", height: 280, colors: ["#4299e1", "#48bb78"], lineOptions: { regionFill: 1 }
            });
        }});

        set_loading("#chart-rev-territory");
        frappe.call({ method: API+"get_chart_revenue_by_territory", args: _filters, callback: r => {
            destroy_chart("o_terr"); $("#chart-rev-territory").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-rev-territory").html('<div class="sa-empty">No data</div>'); return; }
            charts.o_terr = new frappe.Chart("#chart-rev-territory", {
                data: { labels: d.map(x=>x.territory), datasets: [{values: d.map(x=>x.value)}] },
                type: "donut", height: 280, colors: ["#4299e1","#48bb78","#ed8936","#e53e3e","#9f7aea"]
            });
            bind_chart_click("chart-rev-territory", "overview", "territory");
        }});

        set_loading("#chart-top-items");
        frappe.call({ method: API+"get_top_items_by_revenue", args: _filters, callback: r => {
            destroy_chart("o_items"); $("#chart-top-items").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-top-items").html('<div class="sa-empty">No data</div>'); return; }
            charts.o_items = new frappe.Chart("#chart-top-items", {
                data: { labels: d.map(x=>x.item_code), datasets: [{name:"Revenue", values: d.map(x=>x.revenue)}] },
                type: "bar", height: 280, colors: ["#3182ce"]
            });
        }});

        set_loading("#chart-top-customers");
        frappe.call({ method: API+"get_top_customers_by_revenue", args: _filters, callback: r => {
            destroy_chart("o_cust"); $("#chart-top-customers").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-top-customers").html('<div class="sa-empty">No data</div>'); return; }
            charts.o_cust = new frappe.Chart("#chart-top-customers", {
                data: { labels: d.map(x=>x.customer), datasets: [{name:"Revenue", values: d.map(x=>x.revenue)}] },
                type: "bar", height: 280, colors: ["#dd6b20"]
            });
            bind_chart_click("chart-top-customers", "overview", "customer");
        }});

        set_loading("#chart-rev-item-group");
        frappe.call({ method: API+"get_chart_revenue_by_item_group", args: _filters, callback: r => {
            destroy_chart("o_ig"); $("#chart-rev-item-group").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-rev-item-group").html('<div class="sa-empty">No data</div>'); return; }
            charts.o_ig = new frappe.Chart("#chart-rev-item-group", {
                data: { labels: d.map(x=>x.item_group), datasets: [{values: d.map(x=>x.value)}] },
                type: "donut", height: 280, colors: ["#805ad5","#d53f8c","#38b2ac","#3182ce"]
            });
        }});

        frappe.call({ method: API+"get_overview_table", args: _filters, callback: r => {
            let d = r.message || [];
            let tbody = d.map(x => `
                <tr>
                    <td><a onclick="frappe.set_route('Form','Sales Order','${x.docname}')">${x.docname}</a></td>
                    <td>${x.date||""}</td>
                    <td>${x.customer||""}</td>
                    <td>${x.territory||""}</td>
                    <td><span class="sa-status-badge ${status_cls(x.status)}">${x.status}</span></td>
                    <td class="num">${fmt_num(x.amount, 2)}</td>
                    <td class="num">${fmt_num(x.qty, 0)}</td>
                </tr>`).join("") || '<tr><td colspan="7" class="sa-empty">No data</td></tr>';
            $("#tbl-overview-body").html(tbody);
            apply_client_table_filter("overview");
        }});
    }

    // ================= TAB 2: FULFILLMENT LOADERS ================= //
    function load_fulfillment() {
        ["fkpi-pend","fkpi-part","fkpi-comp","fkpi-over","fkpi-pinv","fkpi-val"].forEach(id => $("#"+id).addClass("loading"));
        
        frappe.call({ method: API+"get_fulfillment_kpis", args: _filters, callback: r => {
            let d = r.message || {};
            set_kpi("fkpi-pend", d.pending_delivery, v => fmt_num(v,0));
            set_kpi("fkpi-part", d.partial_delivery, v => fmt_num(v,0), d.partial_delivery > 0 ? "warning" : "");
            set_kpi("fkpi-comp", d.completed_delivery, v => fmt_num(v,0), "success");
            set_kpi("fkpi-over", d.overdue_delivery, v => fmt_num(v,0), d.overdue_delivery > 0 ? "danger" : "");
            set_kpi("fkpi-pinv", d.pending_invoicing, v => fmt_num(v,0));
            set_kpi("fkpi-val", d.value_stuck, fmt_cur);
        }});

        set_loading("#chart-delivery-trend");
        frappe.call({ method: API+"get_chart_delivery_performance_trend", args: _filters, callback: r => {
            destroy_chart("f_trend"); $("#chart-delivery-trend").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-delivery-trend").html('<div class="sa-empty">No data</div>'); return; }
            charts.f_trend = new frappe.Chart("#chart-delivery-trend", {
                data: { labels: d.map(x=>x.month), datasets: [{name:"On Time %", values:d.map(x=>x.on_time_pct)}] },
                type: "line", height: 280, colors: ["#38b2ac"], lineOptions: { regionFill: 1 }
            });
        }});

        set_loading("#chart-fulfillment-split");
        frappe.call({ method: API+"get_chart_fulfillment_status_split", args: _filters, callback: r => {
            destroy_chart("f_split"); $("#chart-fulfillment-split").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-fulfillment-split").html('<div class="sa-empty">No data</div>'); return; }
            charts.f_split = new frappe.Chart("#chart-fulfillment-split", {
                data: { labels: d.map(x=>x.status), datasets: [{values: d.map(x=>x.value)}] },
                type: "donut", height: 280, colors: ["#48bb78","#ed8936","#e2e8f0"]
            });
            bind_chart_click("chart-fulfillment-split", "fulfillment", "status");
        }});

        set_loading("#chart-ordered-delivered");
        frappe.call({ method: API+"get_chart_ordered_vs_delivered_vs_invoiced", args: _filters, callback: r => {
            destroy_chart("f_odi"); $("#chart-ordered-delivered").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-ordered-delivered").html('<div class="sa-empty">No data</div>'); return; }
            charts.f_odi = new frappe.Chart("#chart-ordered-delivered", {
                data: { 
                    labels: d.map(x=>x.item_code), 
                    datasets: [
                        {name:"Ordered", values:d.map(x=>x.ordered)},
                        {name:"Delivered", values:d.map(x=>x.delivered)},
                        {name:"Invoiced", values:d.map(x=>x.invoiced_approx)}
                    ] 
                },
                type: "bar", height: 280, colors: ["#a0aec0","#4299e1","#48bb78"]
            });
        }});

        set_loading("#chart-overdue-customer");
        frappe.call({ method: API+"get_chart_overdue_value_by_customer", args: _filters, callback: r => {
            destroy_chart("f_over"); $("#chart-overdue-customer").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-overdue-customer").html('<div class="sa-empty">No data</div>'); return; }
            charts.f_over = new frappe.Chart("#chart-overdue-customer", {
                data: { labels: d.map(x=>x.customer), datasets: [{name:"Overdue Value", values: d.map(x=>x.value)}] },
                type: "bar", height: 280, colors: ["#e53e3e"]
            });
            bind_chart_click("chart-overdue-customer", "fulfillment", "customer");
        }});

        frappe.call({ method: API+"get_fulfillment_drilldown", args: _filters, callback: r => {
            let sos = r.message || [];
            if (!sos.length) { $("#drilldown-fulfillment").html('<div class="sa-empty">No orders found</div>'); return; }
            
            let html = sos.map(so => {
                let safe_so = so.so_no.replace(/[^a-z0-9]/gi,"_");
                let dn_rows = (so.delivery_notes||[]).map(dn => `
                    <tr class="sa-dd-dn" style="background:#f0f8ff">
                        <td style="padding-left:40px">↳ <a onclick="frappe.set_route('Form','Delivery Note','${dn.dn_no}')">${dn.dn_no}</a></td>
                        <td colspan="4">Date: ${dn.posting_date} | Status: <span class="sa-status-badge ${status_cls(dn.status)}">${dn.status}</span></td>
                    </tr>`).join("");
                
                let si_rows = (so.sales_invoices||[]).map(si => `
                    <tr class="sa-dd-si" style="background:#f0fff4">
                        <td style="padding-left:40px">↳ <a onclick="frappe.set_route('Form','Sales Invoice','${si.si_no}')">${si.si_no}</a></td>
                        <td colspan="4">Date: ${si.posting_date} | Status: <span class="sa-status-badge ${status_cls(si.status)}">${si.status}</span> | Outstanding: ${fmt_num(si.outstanding_amount,2)}</td>
                    </tr>`).join("");
                
                return `
                    <tr class="sa-dd-so" style="cursor:pointer" onclick="sa_toggle_drill('${safe_so}')">
                        <td><strong>▶ <a onclick="event.stopPropagation();frappe.set_route('Form','Sales Order','${so.so_no}')">${so.so_no}</a></strong></td>
                        <td>${so.customer}</td>
                        <td class="num">${fmt_num(so.per_delivered,1)}%</td>
                        <td class="num">${fmt_num(so.per_billed,1)}%</td>
                        <td><span class="sa-status-badge ${status_cls(so.status)}">${so.status}</span></td>
                    </tr>
                    <tr id="so-drill-${safe_so}" style="display:none"><td colspan="5" style="padding:0">
                        <table class="sa-table" style="margin:0; border:none">${dn_rows}${si_rows}</table>
                    </td></tr>
                `;
            }).join("");
            
            $("#drilldown-fulfillment").html(`
                <table class="sa-table" id="tbl-fulfillment"><thead>
                    <tr><th>Order ID</th><th>Customer</th><th class="num">% Delivered</th><th class="num">% Billed</th><th>Status</th></tr>
                </thead><tbody id="tbl-fulfillment-body">${html}</tbody></table>
            `);
            apply_client_table_filter("fulfillment");
        }});

        window.sa_toggle_drill = id => { $("#so-drill-"+id).toggle(); };
    }

    // ================= TAB 3: RECEIVABLES LOADERS ================= //
    function load_receivables() {
        ["rkpi-tout","rkpi-tover","rkpi-tcur","rkpi-oic","rkpi-old"].forEach(id => $("#"+id).addClass("loading"));
        
        frappe.call({ method: API+"get_receivables_kpis", args: _filters, callback: r => {
            let d = r.message || {};
            set_kpi("rkpi-tout", d.total_outstanding, fmt_cur);
            set_kpi("rkpi-tover", d.total_overdue, fmt_cur, d.total_overdue > 0 ? "danger" : "");
            set_kpi("rkpi-tcur", d.current_amount, fmt_cur, "success");
            set_kpi("rkpi-oic", d.overdue_invoice_count, v => fmt_num(v,0));
            set_kpi("rkpi-old", d.oldest_outstanding_days, v => fmt_num(v,0));
        }});

        set_loading("#chart-collections-trend");
        frappe.call({ method: API+"get_chart_collections_trend", args: _filters, callback: r => {
            destroy_chart("r_trend"); $("#chart-collections-trend").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-collections-trend").html('<div class="sa-empty">No data</div>'); return; }
            charts.r_trend = new frappe.Chart("#chart-collections-trend", {
                data: { labels: d.map(x=>x.month), datasets: [{name:"Invoiced", values:d.map(x=>x.invoiced)}, {name:"Collected", values:d.map(x=>x.collected)}] },
                type: "line", height: 280, colors: ["#4299e1", "#48bb78"], lineOptions: { regionFill: 1 }
            });
        }});

        set_loading("#chart-ageing-buckets");
        frappe.call({ method: API+"get_chart_ageing_buckets", args: _filters, callback: r => {
            destroy_chart("r_age"); $("#chart-ageing-buckets").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-ageing-buckets").html('<div class="sa-empty">No data</div>'); return; }
            charts.r_age = new frappe.Chart("#chart-ageing-buckets", {
                data: { labels: d.map(x=>x.bucket), datasets: [{name:"Amount", values:d.map(x=>x.value)}] },
                type: "bar", height: 280, colors: ["#dd6b20"]
            });
            bind_chart_click("chart-ageing-buckets", "receivables", "bucket");
        }});

        set_loading("#chart-top-cust-out");
        frappe.call({ method: API+"get_top_customers_by_outstanding", args: _filters, callback: r => {
            destroy_chart("r_cust"); $("#chart-top-cust-out").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-top-cust-out").html('<div class="sa-empty">No data</div>'); return; }
            charts.r_cust = new frappe.Chart("#chart-top-cust-out", {
                data: { labels: d.map(x=>x.customer), datasets: [{name:"Outstanding", values:d.map(x=>x.outstanding)}] },
                type: "bar", height: 280, colors: ["#e53e3e"]
            });
            bind_chart_click("chart-top-cust-out", "receivables", "customer");
        }});

        set_loading("#chart-out-territory");
        frappe.call({ method: API+"get_chart_outstanding_by_territory_or_group", args: _filters, callback: r => {
            destroy_chart("r_terr"); $("#chart-out-territory").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-out-territory").html('<div class="sa-empty">No data</div>'); return; }
            charts.r_terr = new frappe.Chart("#chart-out-territory", {
                data: { labels: d.map(x=>x.label), datasets: [{values: d.map(x=>x.value)}] },
                type: "donut", height: 280, colors: ["#e53e3e","#ed8936","#ecc94b","#48bb78","#4299e1"]
            });
            bind_chart_click("chart-out-territory", "receivables", "territory");
        }});

        frappe.call({ method: API+"get_receivables_table", args: _filters, callback: r => {
            let d = r.message || [];
            let tbody = d.map(x => `
                <tr class="${x.days_overdue > 0 ? 'sa-row-danger' : ''}">
                    <td><a onclick="frappe.set_route('Form','Sales Invoice','${x.invoice_no}')">${x.invoice_no}</a></td>
                    <td>${x.customer||""}</td>
                    <td>${x.invoice_date||""}</td>
                    <td>${x.due_date||""}</td>
                    <td class="num">${fmt_num(x.invoice_amount, 2)}</td>
                    <td class="num">${fmt_num(x.paid_amount, 2)}</td>
                    <td class="num"><strong>${fmt_num(x.outstanding, 2)}</strong></td>
                    <td class="num">${x.days_overdue > 0 ? `<strong style="color:red">${x.days_overdue}</strong>` : '0'}</td>
                    <td><span class="sa-status-badge sa-badge-gray">${x.ageing_bucket}</span></td>
                </tr>`).join("") || '<tr><td colspan="9" class="sa-empty">No data</td></tr>';
            $("#tbl-receivables-body").html(tbody);
            apply_client_table_filter("receivables");
        }});
    }

    // ================= TAB 4: CUSTOMER ACTIVITY LOADERS ================= //
    function load_activity() {
        ["akpi-act","akpi-risk","akpi-dorm","akpi-rev","akpi-new"].forEach(id => $("#"+id).addClass("loading"));
        
        frappe.call({ method: API+"get_customer_activity_kpis", args: _filters, callback: r => {
            let d = r.message || {};
            set_kpi("akpi-act", d.active_count, v => fmt_num(v,0), "success");
            set_kpi("akpi-risk", d.at_risk_count, v => fmt_num(v,0), "warning");
            set_kpi("akpi-dorm", d.dormant_count, v => fmt_num(v,0), "danger");
            set_kpi("akpi-rev", d.active_revenue, fmt_cur);
            set_kpi("akpi-new", d.new_customers, v => fmt_num(v,0));
        }});

        set_loading("#chart-new-cust-trend");
        frappe.call({ method: API+"get_chart_new_customer_trend", args: _filters, callback: r => {
            destroy_chart("a_trend"); $("#chart-new-cust-trend").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-new-cust-trend").html('<div class="sa-empty">No data</div>'); return; }
            charts.a_trend = new frappe.Chart("#chart-new-cust-trend", {
                data: { labels: d.map(x=>x.month), datasets: [{name:"New Customers", values:d.map(x=>x.value)}] },
                type: "line", height: 280, colors: ["#38b2ac"], lineOptions: { regionFill: 1 }
            });
        }});

        set_loading("#chart-activity-split");
        frappe.call({ method: API+"get_chart_customer_activity_split", args: _filters, callback: r => {
            destroy_chart("a_split"); $("#chart-activity-split").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-activity-split").html('<div class="sa-empty">No data</div>'); return; }
            charts.a_split = new frappe.Chart("#chart-activity-split", {
                data: { labels: d.map(x=>x.status), datasets: [{values: d.map(x=>x.value)}] },
                type: "donut", height: 280, colors: ["#48bb78","#ecc94b","#e53e3e"]
            });
            bind_chart_click("chart-activity-split", "activity", "status");
        }});

        set_loading("#chart-top-dormant");
        frappe.call({ method: API+"get_top_dormant_customers_by_value", args: _filters, callback: r => {
            destroy_chart("a_dorm"); $("#chart-top-dormant").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-top-dormant").html('<div class="sa-empty">No data</div>'); return; }
            charts.a_dorm = new frappe.Chart("#chart-top-dormant", {
                data: { labels: d.map(x=>x.customer), datasets: [{name:"Historical Value", values:d.map(x=>x.value)}] },
                type: "bar", height: 280, colors: ["#e53e3e"]
            });
            bind_chart_click("chart-top-dormant", "activity", "customer");
        }});

        set_loading("#chart-dormant-group");
        frappe.call({ method: API+"get_chart_dormant_value_by_customer_group", args: _filters, callback: r => {
            destroy_chart("a_dgrp"); $("#chart-dormant-group").empty();
            let d = r.message || [];
            if(!d.length) { $("#chart-dormant-group").html('<div class="sa-empty">No data</div>'); return; }
            charts.a_dgrp = new frappe.Chart("#chart-dormant-group", {
                data: { labels: d.map(x=>x.label), datasets: [{values: d.map(x=>x.value)}] },
                type: "donut", height: 280, colors: ["#e53e3e","#ed8936","#ecc94b","#48bb78","#4299e1"]
            });
            bind_chart_click("chart-dormant-group", "activity", "group");
        }});

        frappe.call({ method: API+"get_customer_activity_table", args: _filters, callback: r => {
            let d = r.message || [];
            let tbody = d.map(x => `
                <tr class="${x.status === 'Dormant' ? 'sa-row-danger' : (x.status === 'At-Risk' ? 'sa-row-warning' : '')}">
                    <td><a onclick="frappe.set_route('Form','Customer','${x.customer}')">${x.customer}</a></td>
                    <td>${x.territory||""}</td>
                    <td>${x.customer_group||""}</td>
                    <td>${x.last_order_date||""}</td>
                    <td class="num">${x.days_since_last_order}</td>
                    <td class="num">${fmt_num(x.historical_value, 2)}</td>
                    <td><span class="sa-status-badge ${x.status === 'Dormant' ? 'sa-badge-red' : (x.status === 'At-Risk' ? 'sa-badge-orange' : 'sa-badge-green')}">${x.status}</span></td>
                </tr>`).join("") || '<tr><td colspan="7" class="sa-empty">No data</td></tr>';
            $("#tbl-activity-body").html(tbody);
            apply_client_table_filter("activity");
        }});
    }

    function status_cls(s) {
        if (["Completed","Closed","Paid"].includes(s)) return "sa-badge-green";
        if (["Work In Progress","Partial","Partially Paid"].includes(s)) return "sa-badge-blue";
        if (["On Hold","Overdue","Unpaid"].includes(s)) return "sa-badge-orange";
        if (["Cancelled","Stopped","Return"].includes(s)) return "sa-badge-red";
        return "sa-badge-gray";
    }

    // ── INIT ──────────────────────────────────────────────────────────────
    load_from_url();
    _filters = get_filters();
    window.sa_switch_tab(current_tab); // Initializes tab & loads data
    start_auto_refresh();
};

// ── CSS ────────────────────────────────────────────────────────────
function inject_sales_styles() {
    if (document.getElementById("sa-dash-styles")) return;
    let s = document.createElement("style");
    s.id = "sa-dash-styles";
    s.textContent = `
.sa-dash { padding:20px; font-family:'Inter',sans-serif; background:var(--bg-color,#f7fafc); min-height:100vh; }
.sa-last-updated { text-align:right; font-size:12px; color:#718096; margin-bottom:8px; }
.sa-kpi-row { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:14px; margin-bottom:20px; }
.sa-kpi { background:#fff; border-radius:14px; padding:16px 10px; box-shadow:0 2px 8px rgba(0,0,0,.07); text-align:center; transition:transform .2s,box-shadow .2s; border-top:3px solid #4299e1; }
.sa-kpi:hover { transform:translateY(-3px); box-shadow:0 6px 18px rgba(0,0,0,.12); }
.sa-kpi.loading { opacity:.45; }
.sa-kpi.danger  { border-top-color:#e53e3e; } .sa-kpi.danger .sa-kpi-val { color:#e53e3e; }
.sa-kpi.warning { border-top-color:#ed8936; } .sa-kpi.warning .sa-kpi-val { color:#ed8936; } 
.sa-kpi.success { border-top-color:#48bb78; } .sa-kpi.success .sa-kpi-val { color:#48bb78; }
.sa-kpi-icon { font-size:22px; margin-bottom:6px; } .sa-kpi-val { font-size:24px; font-weight:800; color:#2d3748; } .sa-kpi-label { font-size:10px; color:#718096; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }
.sa-row-2col { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
.sa-row-3col { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:16px; }
@media(max-width:900px){ .sa-row-2col, .sa-row-3col { grid-template-columns:1fr; } }
.sa-chart-card { background:#fff; border-radius:14px; padding:18px; box-shadow:0 2px 8px rgba(0,0,0,.07); }
.sa-chart-title { font-weight:700; font-size:11px; color:#4a5568; margin-bottom:12px; text-transform:uppercase; letter-spacing:.5px; }
.sa-chart-body { min-height:240px; }
.sa-table-card { margin-bottom:16px; }
.sa-table-wrap { overflow-x:auto; }
.sa-table { width:100%; border-collapse:collapse; font-size:13px; }
.sa-table th { background:#f7fafc; color:#4a5568; font-weight:700; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0; font-size:11px; text-transform:uppercase; }
.sa-table td { padding:9px 12px; border-bottom:1px solid #edf2f7; color:#2d3748; vertical-align:middle; }
.sa-table td.num, .sa-table th.num { text-align:right; }
.sa-table tr:hover td { background:#f0f7ff; }
.sa-row-danger td { background:#fff5f5; } .sa-row-warning td { background:#fffaf0; }
.sa-empty { text-align:center; color:#a0aec0; padding:32px !important; font-size:13px; }
.sa-status-badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; }
.sa-badge-green { background:#c6f6d5; color:#22543d; } .sa-badge-blue { background:#bee3f8; color:#2a4365; }
.sa-badge-orange{ background:#feebc8; color:#7b341e; } .sa-badge-red  { background:#fed7d7; color:#742a2a; }
.sa-badge-gray  { background:#e2e8f0; color:#4a5568; }
.sa-spinner { width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#4299e1; border-radius:50%; animation:saspin .8s linear infinite; margin:60px auto; }
@keyframes saspin { to { transform:rotate(360deg); } }
a { cursor:pointer; color:#3182ce; } a:hover { text-decoration:underline; }
.sa-active-filter-bar { display:inline-flex; flex-wrap:wrap; gap:6px; margin-left:12px; vertical-align:middle; }
.sa-filter-chip { background:#ebf8ff; border:1px solid #bee3f8; border-radius:20px; padding:2px 10px; font-size:11px; color:#2b6cb0; }
.sa-tabs { display:flex; gap:8px; border-bottom:1px solid #e2e8f0; margin-top:16px; margin-bottom:20px; }
.sa-tab { padding:10px 20px; cursor:pointer; font-weight:600; font-size:14px; color:#718096; border-bottom:3px solid transparent; transition:all .2s; }
.sa-tab:hover { color:#2b6cb0; background:#ebf8ff; border-radius:6px 6px 0 0; }
.sa-tab.active { color:#2b6cb0; border-bottom-color:#3182ce; }
    `;
    document.head.appendChild(s);
}
