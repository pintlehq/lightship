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
        assert!(app.read(cx).layout.read(cx).panel_visible)
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
