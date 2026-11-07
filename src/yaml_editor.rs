//! Shared YAML presentation, using the public upstream editor through the kit.
use gpui::component::input::{Editor, EditorState};
use gpui::{Context, Entity, Styled, Window, px};
use pintle_gpui_kit::kit as gpui;

pub fn state(window: &mut Window, cx: &mut Context<EditorState>) -> EditorState {
    EditorState::new(window, cx)
        .language("yaml")
        .line_number(true)
        .soft_wrap(false)
}

pub fn editor(state: &Entity<EditorState>, readonly: bool) -> Editor {
    Editor::new(state)
        .readonly(readonly)
        .aria_label(if readonly {
            "Read-only YAML"
        } else {
            "Kubeconfig YAML"
        })
        .text_size(px(13.))
        .size_full()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::component::{ActiveTheme, highlighter::SyntaxHighlighter};
    use gpui::{
        AppContext, IntoElement, Render, TestAppContext, div, prelude::*, test::TestWindowExt,
    };
    use pintle_gpui_kit::theme::{self, ThemeMode};

    struct Viewer(Entity<EditorState>);
    impl Render for Viewer {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().child(editor(&self.0, true))
        }
    }

    #[gpui_kit::test]
    fn yaml_tokens_follow_the_installed_application_theme(cx: &mut TestAppContext) {
        let source = "# Kubernetes\nname: \"สวัสดี 🌊\"\nreplicas: 3\nenabled: true\n";
        let (handle, view) = cx.update(|cx| {
            crate::initialize(cx);
            gpui::open_window(gpui::WindowOptions::default(), cx, |window, cx| {
                cx.new(|cx| Viewer(cx.new(|cx| state(window, cx).default_value(source))))
            })
            .unwrap()
        });
        let mut colors = Vec::new();
        for mode in [ThemeMode::Light, ThemeMode::Dark, ThemeMode::Light] {
            handle
                .update(cx, |_, window, cx| {
                    theme::set_mode(mode, cx);
                    window.render_frame(cx);
                    let input = view.read(cx).0.read(cx);
                    let mut parser = SyntaxHighlighter::new(input.language_name().as_ref());
                    assert!(parser.update(None, input.text(), None));
                    assert!(parser.tree().is_some());
                    let theme = &cx.theme().highlight_theme;
                    assert_eq!(theme.appearance, mode);
                    let spans = parser.styles(&(0..source.len()), theme.as_ref());
                    let string_offset = source.find("สวัสดี").unwrap();
                    let string_color = spans
                        .iter()
                        .find_map(|(range, style)| {
                            range
                                .contains(&string_offset)
                                .then_some(style.color)
                                .flatten()
                        })
                        .expect("YAML strings must receive a syntax color");
                    assert!(
                        spans
                            .iter()
                            .any(|(_, style)| style.color.is_some_and(|c| c != string_color))
                    );
                    colors.push(string_color);
                })
                .unwrap();
        }
        assert_ne!(colors[0], colors[1]);
        assert_eq!(colors[0], colors[2]);
    }
}
