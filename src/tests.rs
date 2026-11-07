use super::*;
use gpui::component::{WindowExt, table::ColumnSort};
use gpui::test::TestWindowExt;
use gpui::{AnyWindowHandle, TestAppContext, point, size};
use pintle_gpui_kit::shell::workspace::SplitDirection;
fn open_empty(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<Lightship>) {
    cx.update(|cx| {
        initialize(cx);
        gpui::open_window(chrome::window_options(cx), cx, |window, cx| {
            cx.new(|cx| Lightship::new(window, cx))
        })
        .unwrap()
    })
}
fn step(cx: &mut TestAppContext, handle: AnyWindowHandle, f: impl FnOnce(&mut Window, &mut App)) {
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        f(window, cx)
    })
    .unwrap();
}
fn active_page(app: &Entity<Lightship>, cx: &App) -> Entity<ResourcePage> {
    let workspace = app.read(cx).workspace.read(cx);
    workspace
        .page(workspace.active_view(cx).unwrap(), cx)
        .unwrap()
        .clone()
        .downcast::<ResourcePage>()
        .unwrap()
}
fn seed(page: &Entity<ResourcePage>, cx: &mut App) {
    let table = page.read(cx).table.clone();
    table.update(cx,|table,cx|{let rows=table.delegate_mut();rows.rows=catalog::fixtures(&rows.cluster,rows.resource);rows.objects=rows.rows.iter().map(|r|(r.id.clone(),serde_json::json!({"metadata":{"uid":r.id,"name":r.name,"namespace":r.namespace}}))).collect();rows.status="Read-only · test fixture".into();rows.rebuild();cx.notify();});
}
fn open(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<Lightship>) {
    let (handle, app) = open_empty(cx);
    step(cx, handle, |window, cx| {
        let manager = app.read(cx).connections.clone();
        manager.update(cx, |m, cx| {
            m.settings.connections.push(backend::config::Connection {
                id: "Development".into(),
                name: "Development".into(),
                context: "test".into(),
                source: backend::config::Source::Files(vec![]),
                trusted_exec: None,
            });
            cx.notify();
        });
        let workspace = app.read(cx).workspace.clone();
        workspace.update(cx, |w, cx| {
            w.open(
                catalog::RESOURCES
                    .iter()
                    .find(|r| r.key == "deployments")
                    .unwrap()
                    .document("Development"),
                OpenMode::Permanent,
                window,
                cx,
            )
        });
        seed(&active_page(&app, cx), cx);
    });
    step(cx, handle, |_, _| {});
    (handle, app)
}
#[gpui_kit::test]
fn onboarding_has_no_demo_or_mutation_controls(cx: &mut TestAppContext) {
    let (handle, _) = open_empty(cx);
    step(cx, handle, |window, cx| {
        assert!(!window.find_all("add-first-cluster").is_empty());
        assert!(window.find_all("new-from-yaml").is_empty());
        window.click("add-first-cluster", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx))
    });
}
#[gpui_kit::test]
fn selection_filter_numeric_sort_and_copy(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let table = cx.update(|cx| page.read(cx).table.clone());
    step(cx, handle, |window, cx| {
        assert!(window.find_all("floating-action-bar").is_empty());
        window.click("select-visible", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(table.read(cx).delegate().selected.len(), 29);
        assert!(!app.read(cx).layout.read(cx).panel_visible);
        assert!(!window.find_all("bulk-copy-names").is_empty());
        assert!(window.find_all("bulk-delete").is_empty());
        window.click("bulk-copy-names", cx);
        assert!(
            cx.read_from_clipboard()
                .unwrap()
                .text()
                .unwrap()
                .contains("development-")
        );
        table.update(cx, |table, cx| {
            let rows = table.delegate_mut();
            rows.namespace = Some("apps".into());
            rows.query = "API".into();
            rows.sort = Some((3, ColumnSort::Descending));
            rows.rebuild();
            assert!(rows.hidden_selected_count() > 0);
            assert!(
                rows.visible
                    .iter()
                    .all(|i| rows.rows[*i].namespace.as_deref() == Some("apps"))
            );
            cx.notify();
        });
    });
    step(cx, handle, |window, cx| {
        window.click("bulk-clear", cx);
        assert!(table.read(cx).delegate().selected.is_empty());
    });
}
#[gpui_kit::test]
fn independent_split_preview_permanent_and_retained_state(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    step(cx, handle, |window, cx| {
        workspace.update(cx, |w, cx| {
            w.open(
                catalog::RESOURCES
                    .iter()
                    .find(|r| r.key == "pods")
                    .unwrap()
                    .document("Development"),
                OpenMode::Preview,
                window,
                cx,
            )
        });
    });
    let view = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    let page = cx.update(|cx| active_page(&app, cx));
    step(cx, handle, |window, cx| {
        assert!(workspace.read(cx).is_preview(view, cx));
        workspace.update(cx, |w, cx| {
            w.open(
                catalog::RESOURCES
                    .iter()
                    .find(|r| r.key == "pods")
                    .unwrap()
                    .document("Development"),
                OpenMode::Permanent,
                window,
                cx,
            )
        });
        assert!(!workspace.read(cx).is_preview(view, cx));
        seed(&page, cx);
        page.update(cx, |p, cx| p.set_namespace(Some("apps".into()), cx));
        workspace.update(cx, |w, cx| w.split(view, SplitDirection::Right, window, cx));
    });
    step(cx, handle, |_, cx| {
        let second = active_page(&app, cx);
        assert_ne!(page.entity_id(), second.entity_id());
        assert!(
            second
                .read(cx)
                .table
                .read(cx)
                .delegate()
                .namespace
                .is_none()
        );
        assert_eq!(
            page.read(cx).table.read(cx).delegate().namespace.as_deref(),
            Some("apps")
        );
    });
}
#[gpui_kit::test]
fn palette_keyboard_escape_and_modal_isolation(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    step(cx, handle, |window, cx| window.click("select-visible", cx));
    step(cx, handle, |window, cx| {
        let page = active_page(&app, cx);
        page.focus_handle(cx).focus(window, cx);
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(
            active_page(&app, cx)
                .read(cx)
                .table
                .read(cx)
                .delegate()
                .selected
                .is_empty()
        );
        window.click("select-visible", cx);
        app.update(cx, |app, cx| app.manage_clusters(window, cx));
        window.press("escape", cx);
    });
    step(cx, handle, |_, cx| {
        assert_eq!(
            active_page(&app, cx)
                .read(cx)
                .table
                .read(cx)
                .delegate()
                .selected
                .len(),
            29
        )
    });
}
#[test]
fn all_test_fixtures_are_deterministic_and_cluster_isolated() {
    let mut ids = std::collections::HashSet::new();
    for cluster in catalog::CLUSTERS {
        for resource in catalog::RESOURCES {
            let rows = catalog::fixtures(cluster, *resource);
            assert!(!rows.is_empty());
            assert_eq!(rows, catalog::fixtures(cluster, *resource));
            for row in rows {
                assert!(ids.insert(row.id));
                assert_eq!(row.cells.len(), resource.columns().len());
            }
        }
    }
}
#[gpui_kit::test]
fn every_resource_page_opens_without_fixture_dependency(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    for resource in catalog::RESOURCES {
        step(cx, handle, |window, cx| {
            workspace.update(cx, |w, cx| {
                w.open(
                    resource.document("Development"),
                    OpenMode::Preview,
                    window,
                    cx,
                )
            });
        });
        step(cx, handle, |_, cx| {
            if resource.key == "overview" {
                let workspace = app.read(cx).workspace.read(cx);
                assert!(
                    workspace
                        .page(workspace.active_view(cx).unwrap(), cx)
                        .unwrap()
                        .downcast::<OverviewPage>()
                        .is_ok()
                );
                return;
            }
            let page = active_page(&app, cx);
            assert_eq!(
                page.read(cx).table.read(cx).delegate().resource.key,
                resource.key
            );
        });
    }
}
#[gpui_kit::test]
fn bulk_overlay_preserves_viewport_scroll_and_pointer_targets(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let table = cx.update(|cx| page.read(cx).table.clone());
    for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
        cx.simulate_window_resize(handle, dimensions);
        for mode in [theme::ThemeMode::Light, theme::ThemeMode::Dark] {
            cx.update(|cx| theme::set_mode(mode, cx));
            step(cx, handle, |_, cx| {
                table.update(cx, |table, cx| table.scroll_to_row(28, cx))
            });
            let mut before = None;
            step(cx, handle, |window, cx| {
                before = Some((
                    window.find("resource-table-viewport").bounds(),
                    window.find(("resource-row", 28usize)).bounds(),
                    table
                        .read(cx)
                        .vertical_scroll_handle
                        .0
                        .borrow()
                        .base_handle
                        .offset(),
                    table.read(cx).horizontal_scroll_handle.offset(),
                ));
                window.click("select-visible", cx);
            });
            step(cx, handle, |window, cx| {
                let (viewport, row, vertical, horizontal) = before.unwrap();
                assert_eq!(window.find("resource-table-viewport").bounds(), viewport);
                assert_eq!(window.find(("resource-row", 28usize)).bounds(), row);
                assert_eq!(
                    table
                        .read(cx)
                        .vertical_scroll_handle
                        .0
                        .borrow()
                        .base_handle
                        .offset(),
                    vertical
                );
                assert_eq!(table.read(cx).horizontal_scroll_handle.offset(), horizontal);
                let bar = window.find("floating-action-bar").bounds();
                assert!(
                    row.bottom() > bar.top(),
                    "rows must continue underneath the overlay"
                );
                assert_eq!(bar.bottom(), viewport.bottom() - px(12.));
                // Click the bar's non-button surface above a real table row.
                window.click_at("floating-action-bar", point(px(8.), px(24.)), cx);
                assert!(
                    !app.read(cx).layout.read(cx).panel_visible,
                    "bar must occlude the row"
                );
                window.click("bulk-clear", cx);
            });
            step(cx, handle, |window, cx| {
                let (viewport, row, vertical, horizontal) = before.unwrap();
                assert!(window.find_all("floating-action-bar").is_empty());
                assert_eq!(window.find("resource-table-viewport").bounds(), viewport);
                assert_eq!(window.find(("resource-row", 28usize)).bounds(), row);
                assert_eq!(
                    table
                        .read(cx)
                        .vertical_scroll_handle
                        .0
                        .borrow()
                        .base_handle
                        .offset(),
                    vertical
                );
                assert_eq!(table.read(cx).horizontal_scroll_handle.offset(), horizontal);
            });
        }
    }
    step(cx, handle, |window, cx| window.click("select-visible", cx));
    let mut bar_before_scroll = None;
    let mut offset_before_scroll = None;
    step(cx, handle, |window, cx| {
        bar_before_scroll = Some(window.find("floating-action-bar").bounds());
        offset_before_scroll = Some(
            table
                .read(cx)
                .vertical_scroll_handle
                .0
                .borrow()
                .base_handle
                .offset(),
        );
        window.scroll(
            "resource-table-viewport",
            gpui::ScrollDelta::Pixels(point(px(0.), px(120.))),
            cx,
        );
    });
    step(cx, handle, |window, cx| {
        let bar = window.find("floating-action-bar").bounds();
        assert_eq!(Some(bar), bar_before_scroll);
        assert_ne!(
            Some(
                table
                    .read(cx)
                    .vertical_scroll_handle
                    .0
                    .borrow()
                    .base_handle
                    .offset()
            ),
            offset_before_scroll
        );
        window.scroll(
            "resource-table-viewport",
            gpui::ScrollDelta::Pixels(point(px(-120.), px(0.))),
            cx,
        );
    });
    step(cx, handle, |window, cx| {
        let bar = window.find("floating-action-bar").bounds();
        assert_eq!(Some(bar), bar_before_scroll);
        assert!(table.read(cx).horizontal_scroll_handle.offset().x < px(0.));
        let viewport = window.find("resource-table-viewport").bounds();
        // Transparent space next to the bar must still inspect a table row.
        let position = point(px(70.), bar.center().y - viewport.top());
        assert!(viewport.left() + position.x < bar.left());
        window.click_at("resource-table-viewport", position, cx);
    });
    step(cx, handle, |_, cx| {
        assert!(!app.read(cx).layout.read(cx).panel_visible);
        let workspace = app.read(cx).workspace.read(cx);
        let page = workspace
            .page(workspace.active_view(cx).unwrap(), cx)
            .unwrap();
        assert!(page.downcast::<DetailPage>().is_ok());
    });
}

#[gpui_kit::test]
fn onboarding_ignores_unselected_plugin_details_and_fits_both_sizes(cx: &mut TestAppContext) {
    let (handle, app) = open_empty(cx);
    step(cx, handle, |window, cx| {
        let config=backend::config::parse_yaml(&format!("apiVersion: v1\nkind: Config\nclusters:\n- name: cluster\n  cluster:\n    server: https://example.invalid\nusers:\n- name: cloud\n  user:\n    exec:\n      command: /usr/bin/true\n      args: [{}]\n      apiVersion: client.authentication.k8s.io/v1\n      interactiveMode: Never\ncontexts:\n- name: not-selected\n  context:\n    cluster: cluster\n    user: cloud\n",vec!["argument";200].join(","))).unwrap();
        let manager = app.read(cx).connections.clone();
        let form = cx.new(|cx| onboarding::AddCluster::new(manager, Vec::new(), window, cx));
        form.update(cx, |form, cx| form.set_test_candidates(config, cx));
        app.update(cx, |app, cx| app.open_add_cluster(form, window, cx));
    });
    for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
        cx.simulate_window_resize(handle, dimensions);
        step(cx, handle, |window, _| {
            let add = window.find("add-selected-clusters").bounds();
            assert!(add.bottom() < dimensions.height);
            assert!(window.find_all("trust:not-selected").is_empty());
        });
    }
}
#[gpui_kit::test]
fn refresh_updates_stable_ids_and_retains_filter_sort_selection(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let table = cx.update(|cx| page.read(cx).table.clone());
    step(cx, handle, |_, cx| {
        table.update(cx,|table,cx|{
        let rows=table.delegate_mut();let object=serde_json::json!({"metadata":{"uid":"stable","name":"app","namespace":"apps"},"spec":{"replicas":2},"status":{"readyReplicas":1}});
        rows.replace(backend::Snapshot{objects:vec![object.clone()],status:"Read-only".into()});let id=rows.rows[0].id.clone();rows.selected.insert(id.clone());rows.query="APP".into();rows.namespace=Some("apps".into());rows.sort=Some((2,ColumnSort::Descending));
        let mut changed=object;changed["status"]["readyReplicas"]=serde_json::json!(2);rows.replace(backend::Snapshot{objects:vec![changed],status:"Read-only".into()});
        assert!(rows.selected.contains(&id));assert_eq!(rows.rows[0].cells[2].text,"2/2");assert_eq!(rows.visible.len(),1);assert_eq!(rows.query,"APP");assert!(rows.sort.is_some());
        rows.replace(backend::Snapshot{objects:vec![],status:"Read-only".into()});assert!(rows.selected.is_empty());cx.notify();
    })
    });
}

fn active_detail(app: &Entity<Lightship>, cx: &App) -> Entity<DetailPage> {
    let workspace = app.read(cx).workspace.read(cx);
    workspace
        .page(workspace.active_view(cx).unwrap(), cx)
        .unwrap()
        .downcast::<DetailPage>()
        .unwrap()
}
fn resource_cell(page: &Entity<ResourcePage>, cx: &App) -> String {
    let rows = page.read(cx).table.read(cx).delegate();
    format!("resource-cell:{}:1", rows.rows[rows.visible[0]].id)
}
fn deployment_detail() -> serde_json::Value {
    serde_json::json!({"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"api","namespace":"apps","uid":"deployment-uid","creationTimestamp":"2026-10-01T00:00:00Z","labels":{"app":"api"},"annotations":{"description":"Application"}},"spec":{"replicas":2,"template":{"spec":{"containers":[{"name":"main","ports":[{"containerPort":3001}]}]}}},"status":{"readyReplicas":1,"updatedReplicas":2,"availableReplicas":1,"conditions":[{"type":"Available","status":"True"}]}})
}
#[gpui_kit::test]
fn row_click_opens_permanent_details_reuses_tab_and_retains_list(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    let (list, page) = cx.update(|cx| {
        (
            workspace.read(cx).active_view(cx).unwrap(),
            active_page(&app, cx),
        )
    });
    let table = cx.update(|cx| page.read(cx).table.clone());
    step(cx, handle, |window, cx| {
        table.update(cx, |table, cx| {
            let rows = table.delegate_mut();
            rows.query = "development".into();
            rows.namespace = Some("apps".into());
            rows.sort = Some((1, ColumnSort::Descending));
            rows.rebuild();
            let id = rows.rows[rows.visible[0]].id.clone();
            rows.selected.insert(id);
            cx.notify();
        });
        window.click(resource_cell(&page, cx), cx);
    });
    let detail = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |window, cx| {
        assert_ne!(detail, list);
        assert!(!workspace.read(cx).is_preview(detail, cx));
        assert!(
            workspace
                .read(cx)
                .page(detail, cx)
                .unwrap()
                .downcast::<DetailPage>()
                .is_ok()
        );
        assert_eq!(workspace.read(cx).groups(cx)[0].views.len(), 2);
        assert!(!app.read(cx).layout.read(cx).panel_visible);
        workspace.update(cx, |w, cx| w.select(list, window, cx));
    });
    step(cx, handle, |window, cx| {
        let rows = table.read(cx).delegate();
        assert_eq!(rows.query, "development");
        assert_eq!(rows.namespace.as_deref(), Some("apps"));
        assert_eq!(rows.selected.len(), 1);
        assert!(rows.sort.is_some());
        window.click(resource_cell(&page, cx), cx);
    });
    step(cx, handle, |_, cx| {
        assert_eq!(workspace.read(cx).active_view(cx), Some(detail));
        assert_eq!(workspace.read(cx).groups(cx)[0].views.len(), 2);
    });
}
#[gpui_kit::test]
fn keyboard_selection_does_not_open_until_enter_and_menu_opens_details(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    let page = cx.update(|cx| active_page(&app, cx));
    let list = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |window, cx| {
        page.read(cx).table.focus_handle(cx).focus(window, cx);
        window.press("down", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(workspace.read(cx).active_view(cx), Some(list));
        window.press("enter", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(
            workspace
                .read(cx)
                .page(workspace.read(cx).active_view(cx).unwrap(), cx)
                .unwrap()
                .downcast::<DetailPage>()
                .is_ok()
        );
        workspace.update(cx, |w, cx| w.select(list, window, cx));
    });
    step(cx, handle, |window, cx| {
        let rows = page.read(cx).table.read(cx).delegate();
        let id = rows.rows[rows.visible[1]].id.clone();
        page.read(cx).table.clone().update(cx, |table, cx| {
            table.scroll_to_col(table.delegate().resource.columns().len() + 1, cx);
        });
        window.render_frame(cx);
        window.click(format!("actions:{id}"), cx);
    });
    step(cx, handle, |window, cx| {
        window.press("down", cx);
        window.press("enter", cx);
    });
    step(cx, handle, |_, cx| {
        assert_eq!(workspace.read(cx).groups(cx)[0].views.len(), 3);
        assert!(
            active_detail(&app, cx)
                .read(cx)
                .target
                .name()
                .contains("development")
        );
    });
}
#[gpui_kit::test]
fn detail_splits_keep_subtabs_independent_and_hide_secrets_when_hidden(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    step(cx, handle, |window, cx| {
        let object = serde_json::json!({"kind":"Secret","metadata":{"name":"credentials","namespace":"apps","uid":"secret-uid"},"data":{"token":"private-value"}});
        app.update(cx, |app, cx| {
            app.open_resource(
                &Inspect {
                    cluster: "Development".into(),
                    key: "secrets".into(),
                    object: object.clone(),
                },
                window,
                cx,
            )
        });
        active_detail(&app, cx).update(cx, |page, cx| {
            page.set_test_detail(object, serde_json::json!({"items":[]}), cx)
        });
    });
    let first = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |window, cx| {
        window.click("reveal-values", cx);
        window.click("detail-tab:YAML", cx);
        assert!(active_detail(&app, cx).read(cx).revealed);
        workspace.update(cx, |w, cx| {
            w.split(first, SplitDirection::Right, window, cx)
        });
    });
    step(cx, handle, |window, cx| {
        let second = active_detail(&app, cx);
        assert!(!second.read(cx).revealed);
        assert!(second.read(cx).tab == detail_page::DetailTab::Overview);
        let left = workspace
            .read(cx)
            .page(first, cx)
            .unwrap()
            .downcast::<DetailPage>()
            .unwrap();
        assert!(left.read(cx).tab == detail_page::DetailTab::Yaml);
        workspace.update(cx, |w, cx| {
            w.select(first, window, cx);
            let doc = catalog::RESOURCES
                .iter()
                .find(|r| r.key == "services")
                .unwrap()
                .document("Development");
            w.open(doc, OpenMode::Permanent, window, cx);
        });
    });
    step(cx, handle, |_, cx| {
        let left = workspace
            .read(cx)
            .page(first, cx)
            .unwrap()
            .downcast::<DetailPage>()
            .unwrap();
        assert!(!left.read(cx).revealed);
    });
}
#[gpui_kit::test]
fn cluster_rename_and_removal_update_and_close_detail_documents(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    step(cx, handle, |window, cx| {
        app.update(cx, |app, cx| {
            app.open_resource(
                &Inspect {
                    cluster: "Development".into(),
                    key: "deployments".into(),
                    object: deployment_detail(),
                },
                window,
                cx,
            )
        })
    });
    let detail = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |_, cx| {
        app.read(cx).connections.clone().update(cx, |m, cx| {
            m.settings.connections[0].name = "Renamed".into();
            cx.notify();
        });
    });
    step(cx, handle, |_, cx| {
        assert!(
            workspace
                .read(cx)
                .document(detail, cx)
                .unwrap()
                .context
                .starts_with("Renamed / apps")
        );
        app.read(cx).connections.clone().update(cx, |m, cx| {
            m.settings.connections.clear();
            cx.notify();
        });
    });
    step(cx, handle, |_, cx| {
        assert!(workspace.read(cx).groups(cx).is_empty());
        assert!(app.read(cx).detail_routes.borrow().is_empty());
    });
}
#[gpui_kit::test]
fn overview_rows_open_category_list_instead_of_synthetic_detail(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    step(cx, handle, |window, cx| {
        app.update(cx, |app, cx| {
            app.open_resource(
                &Inspect {
                    cluster: "Development".into(),
                    key: "overview".into(),
                    object: serde_json::json!({"name":"Services","count":3}),
                },
                window,
                cx,
            )
        })
    });
    step(cx, handle, |_, cx| {
        assert_eq!(
            active_page(&app, cx).read(cx).table.read(cx).delegate().key,
            "services"
        );
        assert!(app.read(cx).detail_routes.borrow().is_empty());
    });
}
#[gpui_kit::test]
fn detail_cards_and_tabs_fit_both_themes_sizes_and_narrow_splits(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    step(cx, handle, |window, cx| {
        app.update(cx, |app, cx| {
            app.open_resource(
                &Inspect {
                    cluster: "Development".into(),
                    key: "deployments".into(),
                    object: deployment_detail(),
                },
                window,
                cx,
            )
        });
        active_detail(&app, cx).update(cx, |page, cx| {
            page.set_test_detail(deployment_detail(), serde_json::json!({"items":[]}), cx)
        });
    });
    for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
        cx.simulate_window_resize(handle, dimensions);
        for mode in [theme::ThemeMode::Light, theme::ThemeMode::Dark] {
            cx.update(|cx| theme::set_mode(mode, cx));
            step(cx, handle, |window, _| {
                let page = window.find("resource-detail-page").bounds();
                let header = window.find("resource-detail-tabs").bounds();
                let summary = window.find("detail-summary").bounds();
                assert!(header.bottom() < page.bottom());
                assert!(summary.size.width <= page.size.width);
                assert!(page.bottom() <= dimensions.height);
                assert!(window.find_all("start-logs").is_empty());
                assert!(!window.find_all("recent-events").is_empty());
            });
        }
    }
    step(cx, handle, |window, cx| {
        let view = workspace.read(cx).active_view(cx).unwrap();
        workspace.update(cx, |w, cx| w.split(view, SplitDirection::Right, window, cx));
        active_detail(&app, cx).update(cx, |page, cx| {
            page.set_test_detail(deployment_detail(), serde_json::json!({"items":[]}), cx)
        });
    });
    step(cx, handle, |window, _| {
        assert_eq!(window.find_all("resource-detail-page").len(), 2);
    });
}

fn active_overview(app: &Entity<Lightship>, cx: &App) -> Entity<OverviewPage> {
    let workspace = app.read(cx).workspace.read(cx);
    workspace
        .page(workspace.active_view(cx).unwrap(), cx)
        .unwrap()
        .downcast::<OverviewPage>()
        .unwrap()
}
fn dashboard(
    cx: &mut TestAppContext,
) -> (AnyWindowHandle, Entity<Lightship>, Entity<OverviewPage>) {
    let (handle, app) = open(cx);
    step(cx, handle, |window, cx| {
        app.read(cx).workspace.clone().update(cx, |w, cx| {
            w.open(
                catalog::RESOURCES
                    .iter()
                    .find(|r| r.key == "overview")
                    .unwrap()
                    .document("Development"),
                OpenMode::Permanent,
                window,
                cx,
            );
        });
        active_overview(&app, cx).update(cx, |page, cx| {
            page.set_test_state(backend::overview::tests::state(chrono::Utc::now()), cx)
        });
    });
    step(cx, handle, |_, _| {});
    step(cx, handle, |_, _| {});
    let page = cx.update(|cx| active_overview(&app, cx));
    (handle, app, page)
}
#[gpui_kit::test]
fn overview_dashboard_has_real_cards_charts_and_responsive_layout(cx: &mut TestAppContext) {
    let (handle, _, _) = dashboard(cx);
    for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
        cx.simulate_window_resize(handle, dimensions);
        for mode in [theme::ThemeMode::Light, theme::ThemeMode::Dark] {
            cx.update(|cx| theme::set_mode(mode, cx));
            step(cx, handle, |_, _| {});
            step(cx, handle, |_, _| {});
            step(cx, handle, |window, _| {
                assert!(window.find_all("resource-table-viewport").is_empty());
                let page = window.find("cluster-overview-page").bounds();
                let nodes = window.find("overview-nodes").bounds();
                let pods = window.find("overview-pods").bounds();
                let cpu = window.find("overview-cpu").bounds();
                assert_eq!(nodes.top(), pods.top());
                if dimensions.width == px(1440.) {
                    assert_eq!(cpu.top(), nodes.top());
                } else {
                    assert!(cpu.top() > nodes.top());
                }
                for id in [
                    "overview-nodes",
                    "overview-pods",
                    "overview-cpu",
                    "overview-memory",
                    "overview-cpu-requests",
                    "overview-memory-requests",
                    "overview-cpu-chart",
                    "overview-memory-chart",
                ] {
                    let bounds = window.find(id).bounds();
                    assert!(bounds.left() >= page.left());
                    assert!(bounds.right() <= page.right() + px(1.));
                }
                assert_eq!(window.find("overview-nodes").label(), Some("NODES: 2"));
                assert_eq!(window.find("overview-pods").label(), Some("PODS: 4 / 96"));
                assert!(window.find("overview-header").bounds().bottom() < page.bottom());
            });
        }
    }
}
#[gpui_kit::test]
fn overview_navigation_cards_namespace_link_and_event_open_documents(cx: &mut TestAppContext) {
    let (handle, app, page) = dashboard(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    let overview = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |window, cx| window.click("overview-nodes", cx));
    step(cx, handle, |window, cx| {
        assert_eq!(
            active_page(&app, cx).read(cx).table.read(cx).delegate().key,
            "nodes"
        );
        workspace.update(cx, |w, cx| w.select(overview, window, cx));
    });
    step(cx, handle, |window, cx| {
        window.click("overview-namespaces", cx)
    });
    step(cx, handle, |window, cx| {
        assert_eq!(
            active_page(&app, cx).read(cx).table.read(cx).delegate().key,
            "namespaces"
        );
        assert!(!workspace.read(cx).groups(cx)[0].views.iter().any(|view| {
            workspace.read(cx).document(*view, cx).unwrap().key.0 == "Development/pods"
        }));
        workspace.update(cx, |w, cx| w.select(overview, window, cx));
        page.update(cx, |page, cx| {
            page.scroll.set_offset(point(px(0.), px(-10000.)));
            cx.notify();
        });
    });
    step(cx, handle, |window, cx| {
        window.click(("overview-event", 0usize), cx);
    });
    step(cx, handle, |_, cx| {
        assert_eq!(active_detail(&app, cx).read(cx).target.name(), "event-0")
    });
}
#[gpui_kit::test]
fn overview_split_keeps_scroll_independent_and_retains_snapshot(cx: &mut TestAppContext) {
    let (handle, app, first) = dashboard(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    cx.simulate_window_resize(handle, size(px(1024.), px(680.)));
    step(cx, handle, |window, cx| {
        let view = workspace.read(cx).active_view(cx).unwrap();
        workspace.update(cx, |w, cx| w.split(view, SplitDirection::Right, window, cx));
        active_overview(&app, cx).update(cx, |page, cx| {
            page.set_test_state(backend::overview::tests::state(chrono::Utc::now()), cx)
        });
    });
    step(cx, handle, |_, _| {});
    step(cx, handle, |_, _| {});
    step(cx, handle, |window, cx| {
        assert_eq!(window.find_all("cluster-overview-page").len(), 2);
        let second = active_overview(&app, cx);
        assert_ne!(first.entity_id(), second.entity_id());
        first.update(cx, |page, cx| {
            page.scroll.set_offset(point(px(0.), px(-200.)));
            cx.notify();
        });
        assert_eq!(second.read(cx).scroll.offset().y, px(0.));
        assert!(first.read(cx).scroll.offset().y < px(0.));
        assert_eq!(first.read(cx).state.cpu_history.len(), 3);
        assert_eq!(second.read(cx).state.cpu_history.len(), 3);
    });
}
#[gpui_kit::test]
fn overview_partial_errors_do_not_show_fake_zeroes_or_hide_other_cards(cx: &mut TestAppContext) {
    let (handle, _, page) = dashboard(cx);
    step(cx, handle, |_, cx| {
        page.update(cx, |page, cx| {
            let mut state = backend::overview::tests::state(chrono::Utc::now());
            let snapshot = state.snapshot.as_mut().unwrap();
            snapshot.cpu = Err("Metrics coverage 1/2 nodes".into());
            snapshot.namespaces = Err("Forbidden".into());
            snapshot.events = Err("Forbidden".into());
            page.set_test_state(state, cx);
        })
    });
    step(cx, handle, |window, _| {
        assert_eq!(window.find("overview-cpu").label(), Some("CPU: —"));
        assert_eq!(window.find("overview-memory").label(), Some("MEMORY: 19%"));
        assert!(!window.find_all("overview-recent-events").is_empty());
    });
}
