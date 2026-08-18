// Copyright (c) 2026, Esoft and contributors
// Production Analytics Dashboard — Phase 2 & 3 Frontend

frappe.pages["production-analytics"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Production Analytics Dashboard"),
        single_column: true
    });

    inject_prod_styles();

    // ── Filter bar fields (Frappe Page toolbar) ──────────────────────────
    let f_from = page.add_field({ fieldname:"from_date", label:__("From Date"), fieldtype:"Date", change: () => apply_filters() });
    let f_to   = page.add_field({ fieldname:"to_date",   label:__("To Date"),   fieldtype:"Date", change: () => apply_filters() });
    let f_wh   = page.add_field({ fieldname:"warehouse",  label:__("Warehouse"),  fieldtype:"Link", options:"Warehouse", change: () => apply_filters() });
    let f_ws   = page.add_field({ fieldname:"workstation",label:__("Workstation"),fieldtype:"Link", options:"Workstation", change: () => apply_filters() });
    let f_st   = page.add_field({ fieldname:"status", label:__("Plan Status"), fieldtype:"Select",
        options:"\nDraft\nSubmitted\nIn Process\nCompleted\nCancelled\nStopped\nDelayed",
        change: () => apply_filters() });
    let f_pp   = page.add_field({ fieldname:"production_plan", label:__("Production Plan"), fieldtype:"Link", options:"Production Plan", change: () => apply_filters() });

    page.set_primary_action(__("Refresh Now"), () => refresh_all(), "refresh");
    page.set_secondary_action(__("Reset Filters"), () => reset_filters(), "close");

    // ── Main container ────────────────────────────────────────────────────
    var $wrap = $('<div class="prod-dash"></div>').appendTo(page.main);

    $wrap.html(`
        <div class="prod-last-updated">
            <span>Last updated: <strong id="pd-last-ts">—</strong></span>
            <span id="pd-active-filters" class="pd-active-filter-bar"></span>
        </div>

        <div class="pd-tabs">
            <div class="pd-tab active" id="tab-btn-plan" onclick="pd_switch_tab('plan')">Production Plan Overview</div>
            <div class="pd-tab" id="tab-btn-jc" onclick="pd_switch_tab('jc')">Lifecycle Drill-down</div>
        </div>

        <div id="tab-content-plan" class="pd-tab-pane active">
            <!-- Row 1: Production Plan KPIs -->
            <div class="pd-kpi-row" id="pd-plan-kpis">
            <div class="pd-kpi loading" id="pkpi-active"><div class="pd-kpi-icon">🏭</div><div class="pd-kpi-val">—</div><div class="pd-kpi-label">Active Plans</div></div>
            <div class="pd-kpi loading" id="pkpi-planned"><div class="pd-kpi-icon">📦</div><div class="pd-kpi-val">—</div><div class="pd-kpi-label">Planned Qty</div></div>
            <div class="pd-kpi loading" id="pkpi-produced"><div class="pd-kpi-icon">✅</div><div class="pd-kpi-val">—</div><div class="pd-kpi-label">Produced Qty</div></div>
            <div class="pd-kpi loading" id="pkpi-pct"><div class="pd-kpi-icon">📊</div><div class="pd-kpi-val">—</div><div class="pd-kpi-label">Completion %</div></div>
            <div class="pd-kpi loading" id="pkpi-delayed"><div class="pd-kpi-icon">⚠️</div><div class="pd-kpi-val">—</div><div class="pd-kpi-label">Delayed Plans</div></div>
            <div class="pd-kpi loading" id="pkpi-mrs"><div class="pd-kpi-icon">📝</div><div class="pd-kpi-val">—</div><div class="pd-kpi-label">Open MRs</div></div>
        </div>

        <!-- Row 2: Bar + Donut -->
        <div class="pd-row-2col">
            <div class="pd-chart-card">
                <div class="pd-chart-title">Item-wise Planned vs Produced</div>
                <div id="chart-item-bar" class="pd-chart-body"></div>
            </div>
            <div class="pd-chart-card">
                <div class="pd-chart-title">Plan Status Distribution</div>
                <div id="chart-plan-donut" class="pd-chart-body"></div>
            </div>
        </div>

        <!-- Row 3: Line + Gauge -->
        <div class="pd-row-2col">
            <div class="pd-chart-card">
                <div class="pd-chart-title">Production Trend (Monthly)</div>
                <div id="chart-trend-line" class="pd-chart-body"></div>
            </div>
            <div class="pd-chart-card">
                <div class="pd-chart-title">Overall Completion</div>
                <div id="chart-completion-gauge" class="pd-chart-body pd-gauge-wrap"></div>
            </div>
        </div>

        <!-- Row 4: Item-wise table -->
        <div class="pd-chart-card pd-table-card">
            <div class="pd-chart-title">Item-wise Planned vs Produced</div>
            <div class="pd-table-wrap"><table class="pd-table" id="tbl-item-wise">
                <thead><tr><th>Item Code</th><th>Item Name</th><th class="num">Planned Qty</th><th class="num">Produced Qty</th><th class="num">Completion %</th></tr></thead>
                <tbody id="tbl-item-wise-body"><tr><td colspan="5" class="pd-empty">Loading…</td></tr></tbody>
            </table></div>
        </div>

        </div><!-- End Tab Plan -->

        <div id="tab-content-jc" class="pd-tab-pane" style="display:none;">
            <!-- In-Depth Drill-down -->
            <div class="pd-chart-card">
                <div class="pd-chart-title" style="margin-bottom:0;">Production Lifecycle Drill-down</div>
                <div id="drilldown-wrap" class="pd-drilldown"></div>
            </div>
        </div><!-- End Tab JC -->
    `);

    // ── State ─────────────────────────────────────────────────────────────
    let charts = {};
    let _autoRefreshTimer = null;
    let _filters = {};
    let _jc_table_filter = {};   // {status, workstation} — set by chart clicks
    let _item_highlight = null;  // set by item bar click
    const API = "esoft_custom_bom.api.production_analytics.";

    // ── Helpers ───────────────────────────────────────────────────────────
    function get_filters() {
        return {
            from_date: f_from.get_value(),
            to_date:   f_to.get_value(),
            warehouse: f_wh.get_value(),
            workstation: f_ws.get_value(),
            status: f_st.get_value(),
            production_plan: f_pp.get_value()
        };
    }

    function fmt_num(v, dec=0) {
        if (v === null || v === undefined) return "—";
        return parseFloat(v).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    function destroy_chart(key) {
        if (charts[key]) { try { charts[key].destroy(); } catch(e) {} charts[key] = null; }
    }

    function set_loading(sel) { $(sel).html('<div class="pd-spinner"></div>'); }

    function apply_filters() {
        _filters = get_filters();
        _jc_table_filter = {};
        _item_highlight = null;
        refresh_all();
        save_to_url();
        render_active_filter_badge();
    }

    function reset_filters() {
        f_from.set_value(""); f_to.set_value(""); f_wh.set_value("");
        f_ws.set_value("");   f_st.set_value(""); f_pp.set_value("");
        _jc_table_filter = {}; _item_highlight = null;
        apply_filters();
    }

    function render_active_filter_badge() {
        let active = Object.entries(_filters).filter(([,v]) => v).map(([k,v]) => `<span class="pd-filter-chip">${k.replace(/_/g,' ')}: <strong>${v}</strong></span>`).join("");
        $("#pd-active-filters").html(active);
    }

    // ── Refresh all widgets ───────────────────────────────────────────────
    function refresh_all() {
        _filters = get_filters();
        load_plan_kpis();
        load_item_bar();
        load_plan_donut();
        load_trend_line();
        load_item_table();
        load_drilldown();
        $("#pd-last-ts").text(frappe.datetime.now_time());
    }

    // ── Auto-refresh (JC widgets only, every 5 min) ───────────────────────
    function start_auto_refresh() {
        if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
        _autoRefreshTimer = setInterval(() => {
            if (document.hidden) return;
            load_drilldown();
            let ts = frappe.datetime.now_time();
            $("#pd-last-ts").text(ts);
            frappe.show_alert({ message: __(`Drill-down refreshed at ${ts}`), indicator: "blue" }, 3);
        }, 5 * 60 * 1000);
    }

    // ── Plan KPIs ─────────────────────────────────────────────────────────
    function load_plan_kpis() {
        ["pkpi-active","pkpi-planned","pkpi-produced","pkpi-pct","pkpi-delayed","pkpi-mrs"].forEach(id => $("#"+id).addClass("loading"));
        frappe.call({ method: API+"get_production_plan_kpis", args: _filters, callback: r => {
            if (!r.message) return;
            let d = r.message;
            set_kpi("pkpi-active",   d.active_plans,    "");
            set_kpi("pkpi-planned",  d.planned_qty,     "", 0);
            set_kpi("pkpi-produced", d.produced_qty,    "", 0);
            set_kpi("pkpi-pct",      d.completion_pct,  "%", 1);
            set_kpi("pkpi-delayed",  d.delayed_plans,   "", 0, d.delayed_plans > 0 ? "danger" : "");
            set_kpi("pkpi-mrs",      d.open_mrs,        "");
        }});
    }

    function set_kpi(id, val, suffix, dec=0, cls="") {
        let $el = $("#"+id);
        $el.removeClass("loading danger warning");
        if (cls) $el.addClass(cls);
        $el.find(".pd-kpi-val").text(fmt_num(val, dec) + suffix);
    }

    // ── Item bar chart ────────────────────────────────────────────────────
    function load_item_bar() {
        set_loading("#chart-item-bar");
        frappe.call({ method: API+"get_item_wise_planned_vs_produced", args: _filters, callback: r => {
            destroy_chart("item_bar");
            $("#chart-item-bar").empty();
            let rows = (r.message || []).slice(0, 15);
            if (!rows.length) { $("#chart-item-bar").html('<div class="pd-empty">No data</div>'); return; }
            charts.item_bar = new frappe.Chart("#chart-item-bar", {
                data: {
                    labels: rows.map(x => x.item_code),
                    datasets: [
                        { name: "Planned", values: rows.map(x => x.planned_qty) },
                        { name: "Produced", values: rows.map(x => x.produced_qty) }
                    ]
                },
                type: "bar", height: 280,
                colors: ["#4299e1","#48bb78"],
                barOptions: { spaceRatio: 0.3 }
            });
            // Click → highlight matching row in item table
            let el = document.getElementById("chart-item-bar");
            if (el) el.addEventListener("click", () => {
                setTimeout(() => {
                    let active = el.querySelector(".x.axis .tick.highlight text, .dataset-units rect.selected");
                    if (active) {
                        let item = active.textContent.trim();
                        _item_highlight = item;
                        $("#tbl-item-wise-body tr").each(function() {
                            let code = $(this).find("td:first a").text().trim();
                            $(this).toggleClass("pd-row-highlight", code === item);
                        });
                        $("#tbl-item-wise-body .pd-row-highlight")[0]?.scrollIntoView({ behavior:"smooth", block:"nearest" });
                    }
                }, 100);
            });
        }});
    }

    // ── Plan status donut ─────────────────────────────────────────────────
    function load_plan_donut() {
        set_loading("#chart-plan-donut");
        frappe.call({ method: API+"get_chart_plan_status_distribution", args: _filters, callback: r => {
            destroy_chart("plan_donut");
            $("#chart-plan-donut").empty();
            let rows = r.message || [];
            if (!rows.length) { $("#chart-plan-donut").html('<div class="pd-empty">No data</div>'); return; }
            charts.plan_donut = new frappe.Chart("#chart-plan-donut", {
                data: { labels: rows.map(x => x.status), datasets: [{ values: rows.map(x => x.count) }] },
                type: "donut", height: 280,
                colors: ["#4299e1","#48bb78","#ed8936","#e53e3e","#a0aec0","#9f7aea"]
            });
            // Click slice → set plan status filter globally
            let el = document.getElementById("chart-plan-donut");
            if (el) el.addEventListener("click", () => {
                setTimeout(() => {
                    let seg = el.querySelector(".legend-dataset-text.highlighted, path.active");
                    if (!seg) return;
                    let label = seg.textContent.trim();
                    let match = rows.find(x => x.status === label);
                    if (match) { f_st.set_value(match.status); apply_filters(); }
                }, 100);
            });
        }});
    }

    // ── Production trend line ─────────────────────────────────────────────
    function load_trend_line() {
        set_loading("#chart-trend-line");
        frappe.call({ method: API+"get_chart_production_trend", args: _filters, callback: r => {
            destroy_chart("trend_line");
            $("#chart-trend-line").empty();
            let rows = r.message || [];
            if (!rows.length) { $("#chart-trend-line").html('<div class="pd-empty">No data</div>'); return; }
            charts.trend_line = new frappe.Chart("#chart-trend-line", {
                data: {
                    labels: rows.map(x => x.month),
                    datasets: [
                        { name: "Planned", values: rows.map(x => x.planned_qty) },
                        { name: "Produced", values: rows.map(x => x.produced_qty) }
                    ]
                },
                type: "line", height: 280,
                colors: ["#4299e1","#48bb78"],
                lineOptions: { hideDots: 0, regionFill: 1 }
            });
        }});
    }

    // ── Completion gauge ──────────────────────────────────────────────────
    function load_completion_gauge(pct) {
        pct = Math.min(100, Math.max(0, pct || 0));
        let color = pct >= 80 ? "#48bb78" : pct >= 50 ? "#ed8936" : "#e53e3e";
        let r = 54, circ = 2 * Math.PI * r;
        let dash = (pct / 100) * circ;
        $("#chart-completion-gauge").html(`
            <div class="pd-gauge">
                <svg width="140" height="140" viewBox="0 0 140 140">
                    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="12"/>
                    <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="12"
                        stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${circ/4}"
                        stroke-linecap="round" style="transition:stroke-dasharray .6s ease"/>
                </svg>
                <div class="pd-gauge-center">
                    <span class="pd-gauge-pct" style="color:${color}">${pct.toFixed(1)}%</span>
                    <span class="pd-gauge-sub">Overall</span>
                </div>
            </div>
        `);
    }

    // ── Item-wise table ───────────────────────────────────────────────────
    function load_item_table() {
        frappe.call({ method: API+"get_item_wise_planned_vs_produced", args: _filters, callback: r => {
            let rows = r.message || [];
            let tbody = rows.map(x => `
                <tr>
                    <td><a onclick="frappe.set_route('List','Item',{item_code:'${x.item_code}'})">${x.item_code}</a></td>
                    <td>${x.item_name||""}</td>
                    <td class="num">${fmt_num(x.planned_qty,0)}</td>
                    <td class="num">${fmt_num(x.produced_qty,0)}</td>
                    <td class="num">
                        <div class="pd-progress-wrap">
                            <div class="pd-progress-bar" style="width:${Math.min(100,x.completion_pct||0)}%;background:${(x.completion_pct||0)>=80?'#48bb78':(x.completion_pct||0)>=50?'#ed8936':'#e53e3e'}"></div>
                            <span>${fmt_num(x.completion_pct,1)}%</span>
                        </div>
                    </td>
                </tr>`).join("") || '<tr><td colspan="5" class="pd-empty">No data</td></tr>';
            $("#tbl-item-wise-body").html(tbody);
            // also update gauge from first plan kpi call — recompute from items
            let total_p = rows.reduce((s,x)=>s+parseFloat(x.planned_qty||0),0);
            let total_r = rows.reduce((s,x)=>s+parseFloat(x.produced_qty||0),0);
            load_completion_gauge(total_p ? (total_r/total_p)*100 : 0);
        }});
    }

    // ── Job Card KPIs ─────────────────────────────────────────────────────
    function load_jc_kpis() {
        ["jkpi-open","jkpi-wip","jkpi-hold","jkpi-week","jkpi-overdue","jkpi-avg"].forEach(id => $("#"+id).addClass("loading"));
        frappe.call({ method: API+"get_job_card_kpis", args: _filters, callback: r => {
            if (!r.message) return;
            let d = r.message;
            set_kpi("jkpi-open",    d.open,                "");
            set_kpi("jkpi-wip",     d.work_in_progress,    "", 0, d.work_in_progress > 0 ? "info" : "");
            set_kpi("jkpi-hold",    d.on_hold,             "", 0, d.on_hold > 0 ? "warning" : "");
            set_kpi("jkpi-week",    d.completed_this_week, "", 0, "success");
            set_kpi("jkpi-overdue", d.overdue,             "", 0, d.overdue > 0 ? "danger" : "");
            set_kpi("jkpi-avg",     d.avg_completion_hrs,  " hrs", 1);
        }});
    }

    // ── Workstation bar (stacked by status) ───────────────────────────────
    function load_ws_bar() {
        set_loading("#chart-ws-bar");
        frappe.call({ method: API+"get_chart_workstation_load", args: _filters, callback: r => {
            destroy_chart("ws_bar");
            $("#chart-ws-bar").empty();
            let rows = r.message || [];
            if (!rows.length) { $("#chart-ws-bar").html('<div class="pd-empty">No data</div>'); return; }
            let ws_set = [...new Set(rows.map(x => x.workstation))];
            let st_set = [...new Set(rows.map(x => x.status))];
            let color_map = {"Open":"#4299e1","Work In Progress":"#48bb78","On Hold":"#ed8936","Completed":"#a0aec0"};
            let datasets = st_set.map(s => ({
                name: s,
                values: ws_set.map(w => { let f = rows.find(x => x.workstation===w && x.status===s); return f ? f.jc_count : 0; })
            }));
            charts.ws_bar = new frappe.Chart("#chart-ws-bar", {
                data: { labels: ws_set, datasets },
                type: "bar", height: 280,
                colors: st_set.map(s => color_map[s] || "#9f7aea"),
                barOptions: { stacked: 1, spaceRatio: 0.3 }
            });
            // Click bar → filter delayed JC table by that workstation
            let el = document.getElementById("chart-ws-bar");
            if (el) el.addEventListener("click", () => {
                setTimeout(() => {
                    let active = el.querySelector(".x.axis .tick.highlight text");
                    if (!active) return;
                    let ws = active.textContent.trim();
                    if (!ws_set.includes(ws)) return;
                    _jc_table_filter.workstation = (_jc_table_filter.workstation === ws) ? null : ws;
                    filter_delayed_table();
                    frappe.show_alert({ message: _jc_table_filter.workstation ? `Delayed table: ${ws}` : "Workstation filter cleared", indicator: "blue" }, 2);
                }, 100);
            });
        }});
    }

    // ── JC status donut ───────────────────────────────────────────────────
    function load_jc_donut() {
        set_loading("#chart-jc-donut");
        frappe.call({ method: API+"get_chart_jobcard_status_distribution", args: _filters, callback: r => {
            destroy_chart("jc_donut");
            $("#chart-jc-donut").empty();
            let rows = r.message || [];
            if (!rows.length) { $("#chart-jc-donut").html('<div class="pd-empty">No data</div>'); return; }
            charts.jc_donut = new frappe.Chart("#chart-jc-donut", {
                data: { labels: rows.map(x => x.status), datasets: [{ values: rows.map(x => x.count) }] },
                type: "donut", height: 280,
                colors: ["#4299e1","#48bb78","#ed8936","#e53e3e","#9f7aea"]
            });
            // Click slice → client-side filter delayed JC table by status
            let el = document.getElementById("chart-jc-donut");
            if (el) el.addEventListener("click", () => {
                setTimeout(() => {
                    let seg = el.querySelector(".legend-dataset-text.highlighted");
                    let label = seg ? seg.textContent.trim() : null;
                    if (label) {
                        _jc_table_filter.status = (_jc_table_filter.status === label) ? null : label;
                        filter_delayed_table();
                        frappe.show_alert({ message: _jc_table_filter.status ? `Delayed table: ${label}` : "Status filter cleared", indicator: "blue" }, 2);
                    }
                }, 100);
            });
        }});
    }

    // Client-side filter on the delayed JC table rows (no refetch needed)
    function filter_delayed_table() {
        $("#tbl-delayed-jc-body tr").each(function() {
            let cells = $(this).find("td");
            if (!cells.length) return;
            let jc_status  = cells.eq(5).text().trim();
            let jc_ws      = cells.eq(3).text().trim();
            let show = true;
            if (_jc_table_filter.status && jc_status !== _jc_table_filter.status) show = false;
            if (_jc_table_filter.workstation && jc_ws !== _jc_table_filter.workstation) show = false;
            $(this).toggle(show);
        });
        let visible = $("#tbl-delayed-jc-body tr:visible").length;
        let parts = [];
        if (_jc_table_filter.status) parts.push(_jc_table_filter.status);
        if (_jc_table_filter.workstation) parts.push(_jc_table_filter.workstation);
        $("#delayed-jc-count").text(visible + (parts.length ? ` shown (${parts.join(", ")})` : " delayed"));
    }

    // ── Throughput line ───────────────────────────────────────────────────
    function load_throughput_line() {
        set_loading("#chart-throughput-line");
        frappe.call({ method: API+"get_chart_jobcard_throughput", args: { ..._filters, granularity:"day" }, callback: r => {
            destroy_chart("throughput");
            $("#chart-throughput-line").empty();
            let rows = (r.message && r.message.data) || [];
            if (!rows.length) { $("#chart-throughput-line").html('<div class="pd-empty">No data</div>'); return; }
            charts.throughput = new frappe.Chart("#chart-throughput-line", {
                data: { labels: rows.map(x => x.period), datasets: [{ name: "Completed", values: rows.map(x => x.completed_count) }] },
                type: "line", height: 280, colors: ["#48bb78"],
                lineOptions: { hideDots: 0, regionFill: 1 }
            });
        }});
    }

    // ── Workstation utilization bar ───────────────────────────────────────
    function load_ws_util() {
        set_loading("#chart-ws-util");
        frappe.call({ method: API+"get_workstation_utilization", args: _filters, callback: r => {
            destroy_chart("ws_util");
            $("#chart-ws-util").empty();
            let rows = r.message || [];
            if (!rows.length) { $("#chart-ws-util").html('<div class="pd-empty">No time log data</div>'); return; }
            charts.ws_util = new frappe.Chart("#chart-ws-util", {
                data: { labels: rows.map(x => x.workstation), datasets: [{ name: "Hours", values: rows.map(x => x.total_hours) }] },
                type: "bar", height: 280, colors: ["#9f7aea"],
                barOptions: { spaceRatio: 0.3 }
            });
        }});
    }

    // ── Delayed JC table ──────────────────────────────────────────────────
    function status_cls(s) {
        if (s==="Completed") return "pd-badge-green";
        if (s==="Work In Progress") return "pd-badge-blue";
        if (s==="On Hold") return "pd-badge-orange";
        return "pd-badge-gray";
    }

    function load_delayed_jc() {
        frappe.call({ method: API+"get_delayed_job_cards", args: _filters, callback: r => {
            let rows = r.message || [];
            $("#delayed-jc-count").text(rows.length ? rows.length+" delayed" : "");
            let tbody = rows.map(x => `
                <tr class="${x.delay_days > 7 ? 'pd-row-danger' : 'pd-row-warning'}">
                    <td><a onclick="frappe.set_route('Form','Job Card','${x.job_card}')">${x.job_card}</a></td>
                    <td><a onclick="frappe.set_route('Form','Work Order','${x.work_order||""}')">${x.work_order||""}</a></td>
                    <td>${x.operation||""}</td><td>${x.workstation||""}</td><td>${x.employee||""}</td>
                    <td><span class="pd-status-badge ${status_cls(x.status)}">${x.status}</span></td>
                    <td>${x.planned_end_date||""}</td>
                    <td class="num pd-text-red"><strong>${x.delay_days}</strong></td>
                </tr>`).join("") || '<tr><td colspan="8" class="pd-empty">No delayed job cards 🎉</td></tr>';
            $("#tbl-delayed-jc-body").html(tbody);
        }});
    }

    // ── Drill-down Plan → WO → JC ─────────────────────────────────────────
    function prog(pct) {
        if(pct===null||pct===undefined||isNaN(pct)) pct=0;
        pct = Math.min(100, Math.max(0, pct));
        let col = pct>=80 ? '#48bb78' : pct>=50 ? '#ed8936' : '#e53e3e';
        return `<div class="pd-stat pd-pct-wrap"><div class="pd-mini-bar"><div style="width:${pct}%;background:${col}"></div></div><span>${pct.toFixed(1)}%</span></div>`;
    }

    function load_drilldown() {
        $("#drilldown-wrap").html('<div class="pd-spinner"></div>');
        frappe.call({ method: API+"get_plan_workorder_jobcard_drilldown", args: _filters, callback: r => {
            let plans = r.message || [];
            if (!plans.length) { $("#drilldown-wrap").html('<div class="pd-empty">No data found</div>'); return; }
            let html = plans.map(p => {
                let safe_plan = p.plan.replace(/[^a-z0-9]/gi,"_");
                let plan_pct = p.total_planned_qty ? (p.total_produced_qty / p.total_planned_qty * 100) : 0;
                
                let it_nodes = (p.items||[]).map(it => {
                    let safe_it = safe_plan+"_"+it.item_code.replace(/[^a-z0-9]/gi,"_");
                    let it_pct = it.planned_qty ? (it.produced_qty / it.planned_qty * 100) : 0;

                    let wo_nodes = (it.work_orders||[]).map(wo => {
                        let safe_wo = wo.work_order.replace(/[^a-z0-9]/gi,"_");
                        let wo_pct = wo.qty ? (wo.produced_qty / wo.qty * 100) : 0;
                        
                        let jc_nodes = (wo.job_cards||[]).map(jc => {
                            let jc_pct = jc.for_quantity ? (jc.total_completed_qty / jc.for_quantity * 100) : 0;
                            return `
                                <div class="pd-node pd-node-jc">
                                    <div class="pd-node-header" onclick="frappe.set_route('Form','Job Card','${jc.job_card}')">
                                        <div class="pd-node-title">
                                            <span class="pd-icon">↳</span>
                                            <span class="pd-name">${jc.job_card}</span>
                                            <span class="pd-status-badge ${status_cls(jc.status)}">${jc.status}</span>
                                            <span style="font-size:12px;color:#718096;font-weight:400">${jc.operation||""} / ${jc.workstation||""}</span>
                                        </div>
                                        <div class="pd-node-stats">
                                            <div class="pd-stat"><label>Dates:</label> <span>${jc.actual_start_date?jc.actual_start_date.split(' ')[0]:"N/A"} - ${jc.actual_end_date?jc.actual_end_date.split(' ')[0]:"N/A"}</span></div>
                                            <div class="pd-stat"><label>Target/Done:</label> <span>${fmt_num(jc.for_quantity,0)} / ${fmt_num(jc.total_completed_qty,0)}</span></div>
                                            ${prog(jc_pct)}
                                        </div>
                                    </div>
                                </div>`;
                        }).join("");

                        let mat_nodes = (wo.materials||[]).map(mat => {
                            let m_pct = mat.required_qty ? (mat.transferred_qty / mat.required_qty * 100) : 0;
                            let shortage = (mat.transferred_qty + mat.actual_qty) < mat.required_qty;
                            return `
                                <div class="pd-node pd-node-mat">
                                    <div class="pd-node-header" style="cursor:default">
                                        <div class="pd-node-title">
                                            <span class="pd-icon">🔩</span>
                                            <span class="pd-name">${mat.item_code}</span>
                                            <span style="font-size:12px;color:#718096;font-weight:400">${mat.item_name||""}</span>
                                        </div>
                                        <div class="pd-node-stats">
                                            <div class="pd-stat"><label>In Stock:</label> <span class="${shortage?'pd-text-red':''}">${fmt_num(mat.actual_qty,0)}</span></div>
                                            <div class="pd-stat"><label>Req/Issued:</label> <span>${fmt_num(mat.required_qty,0)} / ${fmt_num(mat.transferred_qty,0)}</span></div>
                                            ${prog(m_pct)}
                                        </div>
                                    </div>
                                </div>`;
                        }).join("");

                        return `
                            <div class="pd-node pd-node-wo">
                                <div class="pd-node-header" onclick="pd_toggle('jcg-${safe_wo}')">
                                    <div class="pd-node-title">
                                        <span class="pd-icon">▶</span>
                                        <span class="pd-name"><a onclick="event.stopPropagation();frappe.set_route('Form','Work Order','${wo.work_order}')">${wo.work_order}</a></span>
                                        <span class="pd-status-badge ${status_cls(wo.status)}">${wo.status}</span>
                                    </div>
                                    <div class="pd-node-stats">
                                        <div class="pd-stat"><label>Dates:</label> <span>${wo.planned_start_date||"N/A"} - ${wo.planned_end_date||"N/A"}</span></div>
                                        <div class="pd-stat"><label>Target/Done:</label> <span>${fmt_num(wo.qty,0)} / ${fmt_num(wo.produced_qty,0)}</span></div>
                                        ${prog(wo_pct)}
                                    </div>
                                </div>
                                <div class="pd-node-children" id="jcg-${safe_wo}" style="display:none">
                                    <div style="margin-bottom:10px; font-weight:700; font-size:11px; color:#a0aec0; letter-spacing:0.5px;">MATERIALS REQUIRED</div>
                                    ${mat_nodes || '<div class="pd-empty" style="padding:10px">No Materials</div>'}
                                    <div style="margin-top:16px; margin-bottom:10px; font-weight:700; font-size:11px; color:#a0aec0; letter-spacing:0.5px;">OPERATIONS</div>
                                    ${jc_nodes || '<div class="pd-empty" style="padding:10px">No Job Cards</div>'}
                                </div>
                            </div>`;
                    }).join("");

                    return `
                        <div class="pd-node pd-node-item">
                            <div class="pd-node-header" onclick="pd_toggle('wog-${safe_it}')">
                                <div class="pd-node-title">
                                    <span class="pd-icon">📦</span>
                                    <span class="pd-name">${it.item_code}</span>
                                    <span style="font-size:12px;color:#718096;font-weight:400">${it.item_name||""}</span>
                                </div>
                                <div class="pd-node-stats">
                                    <div class="pd-stat"><label>Target/Done:</label> <span>${fmt_num(it.planned_qty,0)} / ${fmt_num(it.produced_qty,0)}</span></div>
                                    ${prog(it_pct)}
                                </div>
                            </div>
                            <div class="pd-node-children" id="wog-${safe_it}" style="display:none">
                                ${wo_nodes || '<div class="pd-empty" style="padding:10px">No Work Orders</div>'}
                            </div>
                        </div>`;
                }).join("");

                return `
                    <div class="pd-node pd-node-plan">
                        <div class="pd-node-header" onclick="pd_toggle('itg-${safe_plan}')">
                            <div class="pd-node-title">
                                <span class="pd-icon">📋</span>
                                <span class="pd-name"><a onclick="event.stopPropagation();frappe.set_route('Form','Production Plan','${p.plan}')">${p.plan}</a></span>
                                <span class="pd-status-badge ${status_cls(p.status)}">${p.status}</span>
                            </div>
                            <div class="pd-node-stats">
                                <div class="pd-stat"><label>Target/Done:</label> <span>${fmt_num(p.total_planned_qty,0)} / ${fmt_num(p.total_produced_qty,0)}</span></div>
                                ${prog(plan_pct)}
                            </div>
                        </div>
                        <div class="pd-node-children" id="itg-${safe_plan}" style="display:none">
                            ${it_nodes || '<div class="pd-empty" style="padding:10px">No Items</div>'}
                        </div>
                    </div>`;
            }).join("");

            $("#drilldown-wrap").html(`<div class="pd-tree" style="margin-top:16px">${html}</div>`);
        }});
    }

    window.pd_toggle = id => { $("#"+id).toggle(); };

    window.pd_switch_tab = function(tab) {
        $(".pd-tab").removeClass("active");
        $("#tab-btn-"+tab).addClass("active");
        $(".pd-tab-pane").hide();
        $("#tab-content-"+tab).show();
    };

    // ── URL filter persistence ────────────────────────────────────────────
    function save_to_url() {
        let params = new URLSearchParams(window.location.search);
        Object.entries(_filters).forEach(([k,v]) => v ? params.set(k,v) : params.delete(k));
        history.replaceState(null,"",window.location.pathname+"?"+params.toString());
    }

    function load_from_url() {
        let p = new URLSearchParams(window.location.search);
        if (p.get("from_date"))       f_from.set_value(p.get("from_date"));
        if (p.get("to_date"))         f_to.set_value(p.get("to_date"));
        if (p.get("warehouse"))       f_wh.set_value(p.get("warehouse"));
        if (p.get("workstation"))     f_ws.set_value(p.get("workstation"));
        if (p.get("status"))          f_st.set_value(p.get("status"));
        if (p.get("production_plan")) f_pp.set_value(p.get("production_plan"));
    }

    // (apply_filters already calls save_to_url — no reassignment needed)

    // ── INIT ──────────────────────────────────────────────────────────────
    load_from_url();
    refresh_all();
    start_auto_refresh();
};

// ── CSS (outside page closure) ────────────────────────────────────────────
function inject_prod_styles() {
    if (document.getElementById("prod-dash-styles")) return;
    let s = document.createElement("style");
    s.id = "prod-dash-styles";
    s.textContent = `
.prod-dash { padding:20px; font-family:'Inter',sans-serif; background:var(--bg-color,#f7fafc); min-height:100vh; }
.prod-last-updated { text-align:right; font-size:12px; color:#718096; margin-bottom:8px; }
.pd-section-title { font-size:15px; font-weight:700; color:#2d3748; margin:24px 0 12px; padding-left:10px; border-left:4px solid #4299e1; }
.pd-kpi-row { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:14px; margin-bottom:20px; }
.pd-kpi { background:#fff; border-radius:14px; padding:18px 14px; box-shadow:0 2px 8px rgba(0,0,0,.07); text-align:center; transition:transform .2s,box-shadow .2s; border-top:3px solid #4299e1; }
.pd-kpi:hover { transform:translateY(-3px); box-shadow:0 6px 18px rgba(0,0,0,.12); }
.pd-kpi.loading { opacity:.45; }
.pd-kpi.danger  { border-top-color:#e53e3e; } .pd-kpi.danger .pd-kpi-val { color:#e53e3e; }
.pd-kpi.warning { border-top-color:#ed8936; } .pd-kpi.success { border-top-color:#48bb78; } .pd-kpi.info { border-top-color:#9f7aea; }
.pd-kpi-icon { font-size:22px; margin-bottom:6px; } .pd-kpi-val { font-size:28px; font-weight:800; color:#2d3748; } .pd-kpi-label { font-size:10px; color:#718096; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }
.pd-row-2col { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
@media(max-width:900px){ .pd-row-2col { grid-template-columns:1fr; } }
.pd-chart-card { background:#fff; border-radius:14px; padding:18px; box-shadow:0 2px 8px rgba(0,0,0,.07); }
.pd-chart-title { font-weight:700; font-size:11px; color:#4a5568; margin-bottom:12px; text-transform:uppercase; letter-spacing:.5px; }
.pd-chart-body { min-height:240px; }
.pd-gauge-wrap { display:flex; align-items:center; justify-content:center; padding:20px; }
.pd-gauge { position:relative; display:inline-block; }
.pd-gauge-center { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; pointer-events:none; }
.pd-gauge-pct { display:block; font-size:26px; font-weight:800; }
.pd-gauge-sub  { display:block; font-size:10px; color:#718096; text-transform:uppercase; }
.pd-table-card { margin-bottom:16px; }
.pd-table-wrap { overflow-x:auto; }
.pd-table { width:100%; border-collapse:collapse; font-size:13px; }
.pd-table th { background:#f7fafc; color:#4a5568; font-weight:700; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0; font-size:11px; text-transform:uppercase; }
.pd-table td { padding:9px 12px; border-bottom:1px solid #edf2f7; color:#2d3748; vertical-align:middle; }
.pd-table td.num, .pd-table th.num { text-align:right; }
.pd-table tr:hover td { background:#f0f7ff; }
.pd-row-danger td { background:#fff5f5; } .pd-row-warning td { background:#fffaf0; }
.pd-empty { text-align:center; color:#a0aec0; padding:32px !important; font-size:13px; }
.pd-progress-wrap { display:flex; align-items:center; gap:8px; }
.pd-progress-bar  { height:7px; border-radius:4px; flex-shrink:0; max-width:80px; min-width:2px; }
.pd-status-badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; }
.pd-badge-green { background:#c6f6d5; color:#22543d; } .pd-badge-blue { background:#bee3f8; color:#2a4365; }
.pd-badge-orange{ background:#feebc8; color:#7b341e; } .pd-badge-red  { background:#fed7d7; color:#742a2a; }
.pd-badge-gray  { background:#e2e8f0; color:#4a5568; }
.pd-drilldown { overflow-x:auto; }
.pd-dd-plan td { background:#ebf8ff; font-weight:700; border-top:2px solid #bee3f8; }
.pd-dd-wo td   { background:#f0fff4; font-size:12px; }
.pd-dd-jc td   { background:#fafafa; font-size:12px; color:#4a5568; }
.pd-dd-item td { background:#edf2f7; font-size:12.5px; color:#2d3748; border-top:1px solid #e2e8f0; }
.pd-dd-plan:hover td, .pd-dd-item:hover td, .pd-dd-wo:hover td { filter:brightness(.97); }
.pd-spinner { width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#4299e1; border-radius:50%; animation:pdspin .8s linear infinite; margin:60px auto; }
@keyframes pdspin { to { transform:rotate(360deg); } }
.pd-text-red { color:#e53e3e; } a { cursor:pointer; color:#3182ce; } a:hover { text-decoration:underline; }
.pd-row-highlight td { background:#fef3c7 !important; outline:2px solid #f59e0b; }
.pd-active-filter-bar { display:inline-flex; flex-wrap:wrap; gap:6px; margin-left:12px; vertical-align:middle; }
.pd-filter-chip { background:#ebf8ff; border:1px solid #bee3f8; border-radius:20px; padding:2px 10px; font-size:11px; color:#2b6cb0; }
.pd-tabs { display:flex; gap:8px; border-bottom:1px solid #e2e8f0; margin-top:16px; margin-bottom:20px; }
.pd-tab { padding:10px 20px; cursor:pointer; font-weight:600; font-size:14px; color:#718096; border-bottom:3px solid transparent; transition:all .2s; }
.pd-tab:hover { color:#2b6cb0; background:#ebf8ff; border-radius:6px 6px 0 0; }
.pd-tab.active { color:#2b6cb0; border-bottom-color:#3182ce; }

.pd-tree { padding: 4px 0; }
.pd-node { margin-bottom: 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
.pd-node-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; transition: background 0.2s; }
.pd-node-header:hover { background: #f8fafc; }
.pd-node-title { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 13.5px; color: #2d3748; }
.pd-node-title .pd-icon { font-size: 14px; opacity: 0.8; }
.pd-node-stats { display: flex; align-items: center; gap: 20px; font-size: 13px; color: #4a5568; }
.pd-stat { display: flex; align-items: center; gap: 6px; }
.pd-stat label { color: #a0aec0; text-transform: uppercase; font-size: 10px; font-weight: 700; margin: 0; letter-spacing: 0.5px; }
.pd-node-children { padding: 10px 10px 10px 28px; background: #f1f5f9; border-top: 1px solid #e2e8f0; }

.pd-node-plan { border-left: 4px solid #4299e1; }
.pd-node-item { border-left: 4px solid #48bb78; }
.pd-node-wo { border-left: 4px solid #ed8936; }
.pd-node-jc { border-left: 4px solid #9f7aea; }
.pd-node-jc .pd-node-header { padding: 8px 16px; }
.pd-node-mat { border-left: 4px solid #a0aec0; background:#f8fafc; margin-bottom: 6px; box-shadow:none; }
.pd-node-mat .pd-node-header { padding: 8px 16px; background: transparent; }
.pd-node-mat .pd-node-header:hover { background: #edf2f7; }

.pd-pct-wrap { width: 130px; display: flex; align-items: center; gap: 10px; font-weight: 700; }
.pd-mini-bar { flex: 1; height: 6px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
.pd-mini-bar div { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
.pd-pct-wrap span { min-width: 45px; text-align: right; font-size: 11px; }
    `;
    document.head.appendChild(s);
}
