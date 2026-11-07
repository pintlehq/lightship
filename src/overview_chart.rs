//! A time-based plot using upstream axes, areas and hover overlays. Gaps are separate paths.
use crate::backend::overview::{Point as Sample, WINDOW};
use chrono::{DateTime, Local, Utc};
use gpui::component::{
    ActiveTheme,
    plot::{
        AxisText, Curve, Grid, Plot, PlotAxis, PlotElement, TooltipState,
        shape::Area,
        tooltip::{CrossLine, Dot, Tooltip},
    },
};
use gpui::{
    AnyElement, App, Bounds, ElementId, Hsla, IntoElement, Pixels, Point, Window, fill, point, px,
    size,
};
use pintle_gpui_kit::kit as gpui;

pub struct UsagePlot {
    pub id: &'static str,
    pub samples: Vec<Sample>,
    pub now: DateTime<Utc>,
    pub color: Hsla,
    pub memory: bool,
}
impl UsagePlot {
    pub fn segments(&self) -> Vec<Vec<(f32, f32)>> {
        let mut segments = Vec::new();
        let mut segment = Vec::new();
        let mut previous = None;
        for sample in &self.samples {
            let age = (self.now - sample.at).num_milliseconds() as f32 / 1000.;
            if !(0. ..=WINDOW as f32).contains(&age) {
                continue;
            }
            if let Some(value) = &sample.value {
                if previous.is_some_and(|at: DateTime<Utc>| (sample.at - at).num_seconds() > 45)
                    && !segment.is_empty()
                {
                    segments.push(std::mem::take(&mut segment));
                }
                segment.push((1. - age / WINDOW as f32, value.allocation.percent() as f32));
                previous = Some(sample.at);
            } else {
                if !segment.is_empty() {
                    segments.push(std::mem::take(&mut segment));
                }
                previous = None;
            }
        }
        if !segment.is_empty() {
            segments.push(segment);
        }
        segments
    }
    fn max(&self) -> f32 {
        let maximum = self
            .samples
            .iter()
            .filter_map(|s| s.value.as_ref())
            .map(|u| u.allocation.percent() as f32)
            .fold(100., f32::max);
        (maximum / 10.).ceil() * 10.
    }
    fn geometry(bounds: Bounds<Pixels>) -> (f32, f32) {
        (
            (bounds.size.width.as_f32() - 46.).max(1.),
            (bounds.size.height.as_f32() - 28.).max(1.),
        )
    }
    fn position(&self, sample: &Sample, bounds: Bounds<Pixels>) -> Option<Point<Pixels>> {
        let value = sample.value.as_ref()?;
        let (w, h) = Self::geometry(bounds);
        let age = (self.now - sample.at).num_milliseconds() as f32 / 1000.;
        if !(0. ..=WINDOW as f32).contains(&age) {
            return None;
        }
        Some(point(
            px(42. + (1. - age / WINDOW as f32) * w),
            px(h * (1. - value.allocation.percent() as f32 / self.max())),
        ))
    }
}
impl IntoElement for UsagePlot {
    type Element = PlotElement<Self>;
    fn into_element(self) -> Self::Element {
        PlotElement::new(self)
    }
}
impl Plot for UsagePlot {
    fn id(&self) -> Option<ElementId> {
        Some(self.id.into())
    }
    fn paint(&mut self, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
        let (w, h) = Self::geometry(bounds);
        let max = self.max();
        let plot = Bounds::new(bounds.origin + point(px(42.), px(0.)), size(px(w), px(h)));
        Grid::new()
            .y((0..=4).map(|i| px(h * i as f32 / 4.)))
            .stroke(cx.theme().border.opacity(0.35))
            .paint(&plot, window);
        for segment in self.segments() {
            if segment.len() == 1 {
                let (x, y) = segment[0];
                let pos = plot.origin + point(px(x * w), px(h * (1. - y / max)));
                window.paint_quad(fill(
                    Bounds::new(pos - point(px(2.), px(2.)), size(px(4.), px(4.))),
                    self.color,
                ));
            } else {
                Area::new()
                    .data(segment)
                    .x(move |(x, _)| Some(x * w))
                    .y0(h)
                    .y1(move |(_, y)| Some(h * (1. - y / max)))
                    .curve(Curve::Linear)
                    .stroke(self.color)
                    .fill(self.color.opacity(0.12))
                    .paint(&plot, window);
            }
        }
        let labels = (0..=2).map(|i| {
            let at = self.now - chrono::Duration::seconds(WINDOW * (2 - i) / 2);
            AxisText::new(
                at.with_timezone(&Local).format("%H:%M").to_string(),
                px(42. + w * i as f32 / 2.),
                cx.theme().muted_foreground,
            )
            .font_size(px(10.))
        });
        PlotAxis::new()
            .x(px(h))
            .y(px(42.))
            .stroke(cx.theme().border)
            .x_label(labels)
            .y_label((0..=2).map(|i| {
                AxisText::new(
                    format!("{:.0}%", max * (2 - i) as f32 / 2.),
                    px(h * i as f32 / 2.),
                    cx.theme().muted_foreground,
                )
                .font_size(px(10.))
            }))
            .paint(&bounds, window, cx);
    }
    fn tooltip_state(
        &self,
        position: Point<Pixels>,
        bounds: Bounds<Pixels>,
        _: &App,
    ) -> Option<TooltipState> {
        let (w, h) = Self::geometry(bounds);
        if position.x < px(42.) || position.x > px(42. + w) || position.y > px(h) {
            return None;
        }
        let (index, p) = self
            .samples
            .iter()
            .enumerate()
            .filter_map(|(i, s)| self.position(s, bounds).map(|p| (i, p)))
            .min_by(|(_, a), (_, b)| {
                (a.x - position.x)
                    .abs()
                    .partial_cmp(&(b.x - position.x).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })?;
        // Do not extend a sample's hit target through an unavailable or unsampled interval.
        if (p.x - position.x).abs() > px((w * 20. / WINDOW as f32).max(4.)) {
            return None;
        }
        Some(TooltipState::new(index, point(p.x, position.y), vec![p]))
    }
    fn tooltip(
        &self,
        state: &TooltipState,
        cursor: Point<Pixels>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        cx: &mut App,
    ) -> Option<AnyElement> {
        let sample = self.samples.get(state.index)?;
        let usage = sample.value.as_ref()?;
        let (_, h) = Self::geometry(bounds);
        let amount = if self.memory {
            format!(
                "{:.2} / {:.2} GiB",
                usage.allocation.used / 1073741824.,
                usage.allocation.total / 1073741824.
            )
        } else {
            format!(
                "{:.2} / {:.2} cores",
                usage.allocation.used, usage.allocation.total
            )
        };
        Some(
            Tooltip::new(cursor, bounds.size)
                .title(
                    sample
                        .at
                        .with_timezone(&Local)
                        .format("%H:%M:%S")
                        .to_string(),
                )
                .row(
                    self.color,
                    if self.memory { "Memory" } else { "CPU" },
                    format!("{:.1}% · {amount}", usage.allocation.percent()),
                )
                .plain_row(
                    "Metrics timestamp",
                    usage
                        .timestamp
                        .with_timezone(&Local)
                        .format("%H:%M:%S")
                        .to_string(),
                )
                .cross_line(CrossLine::new(state.cross_line).height(h))
                .dots(
                    state
                        .dots
                        .iter()
                        .map(|p| Dot::new(*p).fill(self.color).stroke(cx.theme().background)),
                )
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui::component::plot::Plot;
    fn plot(now: DateTime<Utc>) -> UsagePlot {
        UsagePlot {
            id: "test-plot",
            samples: crate::backend::overview::tests::state(now).cpu_history,
            now,
            color: gpui::rgb(0).into(),
            memory: false,
        }
    }
    #[test]
    fn plot_keeps_gaps_single_points_actual_times_and_unclamped_percentages() {
        let now = Utc::now();
        let mut chart = plot(now);
        let segments = chart.segments();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].len(), 3);
        assert!((segments[0][0].0 - (1. - 60. / 1800.)).abs() < 1e-6);
        chart.samples[1].value = None;
        let segments = chart.segments();
        assert_eq!(segments.len(), 2);
        assert!(segments.iter().all(|s| s.len() == 1));
        chart.samples = vec![chart.samples[0].clone()];
        assert_eq!(chart.segments()[0].len(), 1);
        chart.samples[0].value.as_mut().unwrap().allocation.used =
            chart.samples[0].value.as_ref().unwrap().allocation.total * 1.2;
        assert!(chart.max() >= 120.);
        assert!((chart.segments()[0][0].1 - 120.).abs() < 1e-4);
        chart.now = now + chrono::Duration::seconds(1900);
        assert!(chart.segments().is_empty());
    }
    #[gpui_kit::test]
    fn plot_tooltip_selects_actual_sample_and_ignores_unsampled_history(cx: &mut TestAppContext) {
        cx.update(|cx| {
            crate::initialize(cx);
            let chart = plot(Utc::now());
            let bounds = Bounds::new(point(px(0.), px(0.)), size(px(600.), px(170.)));
            let hover = chart
                .tooltip_state(point(px(595.), px(50.)), bounds, cx)
                .unwrap();
            assert_eq!(hover.index, 2);
            assert!(
                chart
                    .tooltip_state(point(px(200.), px(50.)), bounds, cx)
                    .is_none()
            );
        });
    }
}
