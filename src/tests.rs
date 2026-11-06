use super::*;
use gpui::component::WindowExt;
use gpui::test::TestWindowExt;
use gpui::{AnyWindowHandle, TestAppContext, point, size};
use pintle_gpui_kit::shell::workspace::SplitDirection;

fn open(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<Lightship>) {
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
#[gpui_kit::test]
fn resource_navigation_preview_split_and_theme(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    step(cx, handle, |window, cx| {
        assert_eq!(
            window.find("resource-count").label(),
            Some("29 items · Demo data")
        );
        assert_eq!(
            window.find("resource-title").label(),
            Some("Development / Deployments")
        );
        window.click("nav:Development/pods", cx);
    });
    let preview = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |window, cx| {
        assert!(workspace.read(cx).is_preview(preview, cx));
        assert_eq!(
            window.find("resource-title").label(),
            Some("Development / Pods")
        );
        window.double_click("nav:Development/pods", cx);
    });
    let page = cx.update(|cx| {
        assert_eq!(workspace.read(cx).active_view(cx), Some(preview));
        assert!(!workspace.read(cx).is_preview(preview, cx));
        workspace.read(cx).page(preview, cx).unwrap().entity_id()
    });
    step(cx, handle, |window, cx| {
        workspace.update(cx, |workspace, cx| {
            workspace.split(preview, SplitDirection::Right, window, cx)
        });
    });
    for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
        cx.simulate_window_resize(handle, dimensions);
        for mode in [theme::ThemeMode::Light, theme::ThemeMode::Dark] {
            cx.update(|cx| theme::set_mode(mode, cx));
            step(cx, handle, |window, cx| {
                assert_eq!(window.viewport_size(), dimensions);
                assert_eq!(workspace.read(cx).groups(cx).len(), 2);
                assert_eq!(
                    workspace.read(cx).page(preview, cx).unwrap().entity_id(),
                    page
                );
                assert!(!app.read(cx).layout.read(cx).panel_visible);
                for control in window.find_all("new-from-yaml") {
                    assert!(control.bounds().right() <= window.viewport_size().width);
                }
            });
        }
    }
}
#[gpui_kit::test]
fn palette_filtering_and_panel_focus(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    step(cx, handle, |window, cx| window.click("command-search", cx));
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx));
        window.input("Services", cx);
    });
    step(cx, handle, |window, cx| window.press("enter", cx));
    step(cx, handle, |window, cx| {
        assert!(!window.has_active_dialog(cx));
        assert_eq!(
            window.find("resource-title").label(),
            Some("Development / Services")
        );
        window.click("toggle-panel", cx);
    });
    step(cx, handle, |window, cx| {
        window.click(("panel-tab", 1usize), cx);
        assert_eq!(
            window.find("panel-content").label(),
            Some("Resource details and activity")
        );
        window.press("left", cx);
        assert_eq!(app.read(cx).panel_tab, 0);
        window.click("close-panel", cx);
    });
    step(cx, handle, |window, cx| {
        let expected = app.read(cx).workspace.read(cx).active_focus_handle(cx);
        assert!(!app.read(cx).layout.read(cx).panel_visible);
        assert_eq!(window.focused(cx), Some(expected));
        window.click("toggle-panel", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(app.read(cx).layout.read(cx).panel_visible);
        window.click("activity-explorer", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(!app.read(cx).layout.read(cx).sidebar_visible);
        assert_eq!(
            window.focused(cx),
            Some(app.read(cx).workspace.read(cx).active_focus_handle(cx))
        );
        window.press(
            if cfg!(target_os = "macos") {
                "cmd-k"
            } else {
                "ctrl-k"
            },
            cx,
        );
    });
    step(cx, handle, |window, cx| window.input("Toggle Sidebar", cx));
    step(cx, handle, |window, cx| window.press("enter", cx));
    cx.update(|cx| assert!(app.read(cx).layout.read(cx).sidebar_visible));
}
#[gpui_kit::test]
fn resizing_and_hidden_panel_retain_geometry(cx: &mut TestAppContext) {
    let (handle, _) = open(cx);
    step(cx, handle, |window, cx| window.click("toggle-panel", cx));
    let mut height = px(0.);
    step(cx, handle, |window, cx| {
        let edge = window
            .within("workspace-sidebar")
            .find_all(("resizable-handle", 0usize))
            .into_iter()
            .next()
            .unwrap()
            .bounds()
            .center();
        let width = window.find("lightship-sidebar").bounds().size.width;
        window.drag(edge, edge + point(px(50.), px(0.)), cx);
        assert!(
            (window.find("lightship-sidebar").bounds().size.width - width - px(50.)).abs() < px(3.)
        );
        let edge = window
            .within("workspace-inspector")
            .find_all(("resizable-handle", 0usize))
            .into_iter()
            .next()
            .unwrap()
            .bounds()
            .center();
        window.drag(edge, edge - point(px(0.), px(40.)), cx);
        height = window.find("lightship-panel").bounds().size.height;
        window.click("close-panel", cx);
    });
    step(cx, handle, |window, cx| window.click("toggle-panel", cx));
    step(cx, handle, |window, _| {
        assert_eq!(window.find("lightship-panel").bounds().size.height, height)
    });
}

fn active_page(app: &Entity<Lightship>, cx: &App) -> Entity<ResourcePage> {
    let workspace = app.read(cx).workspace.read(cx);
    workspace
        .page(workspace.active_view(cx).unwrap(), cx)
        .unwrap()
        .downcast::<ResourcePage>()
        .unwrap()
}
#[test]
fn catalog_fixtures_are_complete_deterministic_and_isolated() {
    use std::collections::HashSet;
    let mut ids = HashSet::new();
    assert_eq!(documents().len(), catalog::RESOURCES.len() * 3);
    for cluster in catalog::CLUSTERS {
        for resource in catalog::RESOURCES {
            let rows = catalog::fixtures(cluster, *resource);
            assert!(!rows.is_empty());
            assert_eq!(rows, catalog::fixtures(cluster, *resource));
            if resource.key == "deployments" {
                assert_eq!(rows.len(), 29);
            }
            for row in rows {
                assert!(ids.insert(row.id));
                assert_eq!(row.cells.len(), resource.columns().len());
                assert_eq!(row.namespace.is_some(), resource.namespaced);
            }
        }
        let overview = catalog::fixtures(cluster, catalog::RESOURCES[0]);
        for (row, resource) in overview.iter().zip(&catalog::RESOURCES[1..]) {
            assert_eq!(
                row.cells[1].number,
                Some(catalog::fixtures(cluster, *resource).len() as u64)
            );
        }
    }
}
#[gpui_kit::test]
fn filtering_selection_sort_refresh_and_demo_dialog(cx: &mut TestAppContext) {
    use gpui::component::table::ColumnSort;
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    step(cx, handle, |window, cx| {
        window.click("table-filter", cx);
        window.input("API", cx);
    });
    step(cx, handle, |_, cx| {
        page.update(cx, |page, cx| {
            page.set_namespace(Some("default".into()), cx)
        });
        let table = page.read(cx).table.clone();
        table.update(cx, |table, cx| {
            let rows = table.delegate_mut();
            assert_eq!(rows.visible.len(), 2);
            rows.select_visible(true);
            assert_eq!(rows.selection_state(), (true, false));
            let first = rows.rows[rows.visible[0]].id.clone();
            rows.selected.remove(&first);
            assert_eq!(rows.selection_state(), (false, true));
            rows.sort = Some((5, ColumnSort::Ascending));
            rows.rebuild();
            let ages: Vec<_> = rows
                .visible
                .iter()
                .map(|i| rows.rows[*i].cells[5].number.unwrap())
                .collect();
            assert!(ages.windows(2).all(|v| v[0] <= v[1]));
            cx.notify();
        });
    });
    step(cx, handle, |window, cx| {
        window.click("refresh-resources", cx)
    });
    step(cx, handle, |window, cx| {
        let table = page.read(cx).table.read(cx);
        let rows = table.delegate();
        assert_eq!(rows.query, "API");
        assert_eq!(rows.visible.len(), 2);
        assert_eq!(rows.selected.len(), 1);
        assert_eq!(app.read(cx).panel_state.read(cx).output.len(), 1);
        window.click("new-from-yaml", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx));
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        page.read(cx).filter.clone().update(cx, |input, cx| {
            input.set_value("no-such-resource", window, cx);
            cx.emit(gpui::component::input::InputEvent::Change);
        });
    });
    step(cx, handle, |window, _| {
        assert!(window.find("no-results").visible())
    });
}
#[gpui_kit::test]
fn all_pages_open_and_split_retains_independent_filters(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    for document in documents() {
        step(cx, handle, |window, cx| {
            workspace.update(cx, |workspace, cx| {
                workspace.open(document.clone(), OpenMode::Preview, window, cx);
            });
        });
        step(cx, handle, |window, _| {
            assert_eq!(
                window.find("resource-title").label(),
                Some(format!("{} / {}", document.context, document.title).as_str())
            )
        });
    }
    let original = cx.update(|cx| active_page(&app, cx));
    step(cx, handle, |window, cx| {
        original.read(cx).filter.clone().update(cx, |input, cx| {
            input.set_value("production", window, cx);
            cx.emit(gpui::component::input::InputEvent::Change);
        });
    });
    step(cx, handle, |window, cx| {
        workspace.update(cx, |workspace, cx| {
            let view = workspace.active_view(cx).unwrap();
            workspace.split(view, SplitDirection::Right, window, cx);
        });
    });
    step(cx, handle, |_, cx| {
        let split = active_page(&app, cx);
        assert_ne!(original.entity_id(), split.entity_id());
        assert!(split.read(cx).table.read(cx).delegate().query.is_empty());
        assert_eq!(
            original.read(cx).table.read(cx).delegate().query,
            "production"
        );
    });
}
#[gpui_kit::test]
fn checkboxes_and_row_inspection_use_stable_ids(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    step(cx, handle, |window, cx| window.click("select-visible", cx));
    step(cx, handle, |_, cx| {
        assert_eq!(page.read(cx).table.read(cx).delegate().selected.len(), 29)
    });
    step(cx, handle, |window, cx| {
        window.click("select:Development/deployments/development-api-01", cx)
    });
    step(cx, handle, |_, cx| {
        assert_eq!(
            page.read(cx).table.read(cx).delegate().selection_state(),
            (false, true)
        );
        page.read(cx)
            .table
            .clone()
            .update(cx, |table, cx| table.set_selected_row(0, cx));
    });
    step(cx, handle, |window, cx| {
        assert!(app.read(cx).layout.read(cx).panel_visible);
        assert!(
            app.read(cx)
                .panel_state
                .read(cx)
                .details
                .contains("development-api-01")
        );
        window.click("close-panel", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(window.focused(cx), Some(page.focus_handle(cx)))
    });
}

#[gpui_kit::test]
fn table_scrolling_sort_controls_and_tab_state(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let table = cx.update(|cx| page.read(cx).table.clone());
    cx.simulate_window_resize(handle, size(px(1024.), px(680.)));
    step(cx, handle, |window, cx| {
        window.scroll(
            "table-cell-0:1",
            gpui::ScrollDelta::Pixels(point(px(-400.), px(0.))),
            cx,
        );
    });
    step(cx, handle, |window, cx| {
        assert!(table.read(cx).horizontal_scroll_handle.offset().x < px(0.));
        table.update(cx, |table, cx| table.scroll_to_col(6, cx));
        window.render_frame(cx);
        window.click(("icon-sort", 6usize), cx);
    });
    step(cx, handle, |_, cx| {
        let table = table.read(cx);
        let rows = table.delegate();
        assert!(rows.sort.is_some());
        let ages: Vec<_> = rows
            .visible
            .iter()
            .map(|i| rows.rows[*i].cells[5].number.unwrap())
            .collect();
        assert!(ages.windows(2).all(|v| v[0] >= v[1]));
    });
    step(cx, handle, |window, cx| {
        window.click("refresh-resources", cx)
    });
    step(cx, handle, |window, cx| {
        window.click(("icon-sort", 6usize), cx);
    });
    step(cx, handle, |_, cx| {
        let rows = table.read(cx).delegate();
        let ages: Vec<_> = rows
            .visible
            .iter()
            .map(|i| rows.rows[*i].cells[5].number.unwrap())
            .collect();
        assert!(ages.windows(2).all(|v| v[0] <= v[1]));
    });
    let offset = cx.update(|cx| table.read(cx).horizontal_scroll_handle.offset());
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    let original = cx.update(|cx| workspace.read(cx).active_view(cx).unwrap());
    step(cx, handle, |window, cx| {
        workspace.update(cx, |workspace, cx| {
            workspace.open(
                catalog::RESOURCES[3].document("Staging"),
                OpenMode::Permanent,
                window,
                cx,
            );
        });
    });
    step(cx, handle, |window, cx| {
        workspace.update(cx, |workspace, cx| workspace.select(original, window, cx));
    });
    step(cx, handle, |_, cx| {
        assert_eq!(active_page(&app, cx).entity_id(), page.entity_id());
        assert_eq!(table.read(cx).horizontal_scroll_handle.offset(), offset);
        assert_eq!(
            app.read(cx)
                .navigation
                .read(cx)
                .state
                .read(cx)
                .selected_item()
                .unwrap()
                .id,
            "Development/deployments"
        );
    });
}

#[test]
fn bulk_capabilities_and_replica_validation() {
    use bulk::{BulkAction::*, parse_replicas};
    for resource in catalog::RESOURCES {
        let expected: &[bulk::BulkAction] = match resource.key {
            "overview" => &[],
            "deployments" | "statefulsets" => &[Delete, Scale, Restart],
            "daemonsets" => &[Delete, Restart],
            _ => &[Delete],
        };
        assert_eq!(bulk::BulkAction::for_resource(*resource), expected);
    }
    for (text, expected) in [
        ("0", Some(0)),
        ("1", Some(1)),
        ("2147483647", Some(i32::MAX)),
        ("2147483648", None),
        ("-1", None),
        ("+1", None),
        ("1.5", None),
        ("", None),
        (" ", None),
        ("x", None),
    ] {
        assert_eq!(parse_replicas(text), expected, "{text}");
    }
}

#[gpui_kit::test]
fn bulk_selection_hidden_rows_cancel_and_escape(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    step(cx, handle, |window, cx| {
        assert!(window.find_all("floating-action-bar").is_empty());
        window.click("select:Development/deployments/development-api-01", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(
            !app.read(cx).layout.read(cx).panel_visible,
            "checkbox must not inspect the row"
        );
        assert_eq!(
            window.find("bulk-selection-summary").label(),
            Some("1 selected")
        );
        window.click("select:Development/deployments/development-web-02", cx);
    });
    step(cx, handle, |window, cx| {
        page.update(cx, |page, cx| {
            page.set_namespace(Some("default".into()), cx)
        });
        page.read(cx).filter.clone().update(cx, |input, cx| {
            input.set_value("no-such-resource", window, cx);
            cx.emit(gpui::component::input::InputEvent::Change);
        });
    });
    step(cx, handle, |window, cx| {
        assert_eq!(
            window.find("bulk-selection-summary").label(),
            Some("2 selected · 2 hidden by filters")
        );
        assert!(window.find("no-results").visible());
        window.click("refresh-resources", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(page.read(cx).table.read(cx).delegate().selected.len(), 2);
        window.click("bulk-delete", cx);
    });
    step(cx, handle, |window, cx| {
        let dialog = page.read(cx).bulk_dialog.as_ref().unwrap().read(cx);
        assert_eq!(dialog.targets.len(), 2);
        assert_eq!(dialog.hidden, 2);
        assert!(window.has_active_dialog(cx));
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(!window.has_active_dialog(cx));
        assert_eq!(page.read(cx).table.read(cx).delegate().selected.len(), 2);
        assert_eq!(app.read(cx).panel_state.read(cx).output.len(), 1); // Refresh only.
        window.click("command-search", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx));
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(page.read(cx).table.read(cx).delegate().selected.len(), 2);
        page.focus_handle(cx).focus(window, cx);
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        assert!(window.find_all("floating-action-bar").is_empty());
        assert!(page.read(cx).table.read(cx).delegate().selected.is_empty());
        assert_eq!(window.focused(cx), Some(page.focus_handle(cx)));
    });
}

#[gpui_kit::test]
fn bulk_scale_snapshot_output_and_fixture_integrity(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let fixtures = cx.update(|cx| page.read(cx).table.read(cx).delegate().rows.clone());
    step(cx, handle, |window, cx| window.click("select-visible", cx));
    step(cx, handle, |window, cx| window.click("bulk-scale", cx));
    let dialog = cx.update(|cx| page.read(cx).bulk_dialog.clone().unwrap());
    step(cx, handle, |window, cx| {
        assert_eq!(dialog.read(cx).targets, fixtures);
        dialog.read(cx).replicas.clone().update(cx, |input, cx| {
            input.set_value("-1", window, cx);
            cx.emit(gpui::component::input::InputEvent::Change);
        });
    });
    step(cx, handle, |window, cx| {
        assert!(window.find("bulk-replicas-error").visible());
        window.click("bulk-confirm", cx);
        window.press("enter", cx);
        assert!(window.has_active_dialog(cx));
        assert!(app.read(cx).panel_state.read(cx).output.is_empty());
        dialog.read(cx).replicas.clone().update(cx, |input, cx| {
            input.set_value("0", window, cx);
            cx.emit(gpui::component::input::InputEvent::Change);
        });
        // A changed selection must not rewrite an already-open command's targets.
        page.read(cx).table.clone().update(cx, |table, cx| {
            let id = table.delegate().rows[0].id.clone();
            table.delegate_mut().selected.remove(&id);
            cx.notify();
        });
    });
    step(cx, handle, |window, cx| window.click("bulk-confirm", cx));
    step(cx, handle, |window, cx| {
        assert!(!window.has_active_dialog(cx));
        let panel = app.read(cx).panel_state.read(cx);
        assert_eq!(panel.output.len(), 1);
        assert!(panel.output[0].contains("29 selected"));
        assert!(panel.output[0].contains("replicas=0"));
        assert!(panel.output[0].contains("default/development-api-01"));
        assert!(panel.output[0].contains("No resources were changed."));
        assert_eq!(app.read(cx).panel_tab, 1);
        assert!(app.read(cx).layout.read(cx).panel_visible);
        assert_eq!(page.read(cx).table.read(cx).delegate().rows, fixtures);
        assert_eq!(page.read(cx).table.read(cx).delegate().selected.len(), 28);
        window.press("escape", cx);
    });
    step(cx, handle, |_, cx| {
        assert!(page.read(cx).table.read(cx).delegate().selected.is_empty())
    });
}

#[gpui_kit::test]
fn bulk_responsive_bar_split_and_overview(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let workspace = cx.update(|cx| app.read(cx).workspace.clone());
    step(cx, handle, |window, cx| window.click("select-visible", cx));
    for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
        cx.simulate_window_resize(handle, dimensions);
        for mode in [theme::ThemeMode::Light, theme::ThemeMode::Dark] {
            cx.update(|cx| theme::set_mode(mode, cx));
            step(cx, handle, |_, _| {});
            step(cx, handle, |window, cx| {
                let bar = window.find("floating-action-bar").bounds();
                assert!(bar.left() >= px(0.) && bar.right() <= dimensions.width);
                page.read(cx).table.clone().update(cx, |table, cx| {
                    table.scroll_to_row(28, cx);
                    table.scroll_to_col(6, cx);
                });
            });
            step(cx, handle, |window, _| {
                let bar = window.find("floating-action-bar").bounds();
                let last = window.find(("resource-row", 28usize)).bounds();
                assert!(last.bottom() > bar.top(), "rows extend behind the overlay");
            });
        }
    }
    step(cx, handle, |window, cx| {
        workspace.update(cx, |workspace, cx| {
            let view = workspace.active_view(cx).unwrap();
            workspace.split(view, SplitDirection::Right, window, cx);
        });
    });
    step(cx, handle, |_, _| {});
    step(cx, handle, |window, cx| {
        assert!(page.read(cx).compact_actions);
        assert_eq!(window.find_all("floating-action-bar").len(), 1);
        assert!(window.find("bulk-more").visible());
        let split = active_page(&app, cx);
        assert_ne!(split.entity_id(), page.entity_id());
        assert!(split.read(cx).table.read(cx).delegate().selected.is_empty());
        workspace.update(cx, |workspace, cx| {
            workspace.open(
                catalog::RESOURCES[0].document("Development"),
                OpenMode::Permanent,
                window,
                cx,
            );
        });
    });
    step(cx, handle, |_, cx| {
        let overview = active_page(&app, cx);
        assert_eq!(
            overview.read(cx).table.read(cx).delegate().resource.key,
            "overview"
        );
        overview.update(cx, |page, cx| {
            page.table.update(cx, |table, cx| {
                table.delegate_mut().select_visible(true);
                cx.notify();
            });
        });
    });
    step(cx, handle, |window, _| {
        assert_eq!(window.find_all("floating-action-bar").len(), 1)
    });
}

#[gpui_kit::test]
fn bulk_keyboard_simulation_cancel_and_focus_fallback(cx: &mut TestAppContext) {
    let (handle, app) = open(cx);
    let page = cx.update(|cx| active_page(&app, cx));
    let fixtures = cx.update(|cx| page.read(cx).table.read(cx).delegate().rows.clone());
    step(cx, handle, |window, cx| window.click("select-visible", cx));
    step(cx, handle, |window, cx| window.click("bulk-delete", cx));
    step(cx, handle, |window, cx| window.click("bulk-cancel", cx));
    step(cx, handle, |window, cx| {
        assert!(!window.has_active_dialog(cx));
        assert!(app.read(cx).panel_state.read(cx).output.is_empty());
        window.press("enter", cx); // Restored focus activates Delete.
    });
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx));
        window.click("bulk-confirm", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(app.read(cx).panel_state.read(cx).output.len(), 1);
        window.press("space", cx); // Space also activates the restored button.
    });
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx));
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        window.press("tab", cx);
        window.press("enter", cx); // Next action is Scale.
    });
    step(cx, handle, |window, cx| {
        assert!(window.has_active_dialog(cx));
        assert_eq!(
            page.read(cx).bulk_dialog.as_ref().unwrap().read(cx).action,
            bulk::BulkAction::Scale
        );
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| window.click("bulk-restart", cx));
    step(cx, handle, |window, cx| window.press("enter", cx));
    step(cx, handle, |window, cx| {
        assert!(!window.has_active_dialog(cx));
        let output = &app.read(cx).panel_state.read(cx).output;
        assert_eq!(output.len(), 2);
        assert!(output[0].contains("Delete"));
        assert!(output[1].contains("Rolling restart"));
        assert_eq!(page.read(cx).table.read(cx).delegate().rows, fixtures);
        window.click("bulk-delete", cx);
    });
    step(cx, handle, |window, cx| {
        page.read(cx).table.clone().update(cx, |table, cx| {
            table.delegate_mut().selected.clear();
            cx.notify();
        });
        window.press("escape", cx);
    });
    step(cx, handle, |window, cx| {
        assert_eq!(window.focused(cx), Some(page.focus_handle(cx)));
        assert!(window.find_all("floating-action-bar").is_empty());
    });
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
