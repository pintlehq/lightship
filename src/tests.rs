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
