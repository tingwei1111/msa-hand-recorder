//! Browser bindings expose only the projection and platform-specific ECMAScript primitives.

use crate::{project_with_host, HostSemantics};
use std::cmp::Ordering;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = __MSADeckTrackerHost, js_name = dateParse)]
    fn date_parse(value_json: &str) -> f64;
    #[wasm_bindgen(js_namespace = __MSADeckTrackerHost, js_name = compare)]
    fn compare(left_json: &str, right_json: &str) -> i32;
    #[wasm_bindgen(js_namespace = __MSADeckTrackerHost, js_name = uppercase)]
    fn uppercase(value_json: &str) -> String;
}

#[derive(Debug)]
struct BrowserSemantics;

impl HostSemantics for BrowserSemantics {
    fn date_parse(&self, value_wire_json: &str) -> f64 {
        date_parse(value_wire_json)
    }

    fn compare(&self, left: &[u16], right: &[u16]) -> Ordering {
        let left = serde_json::to_string(left).expect("UTF-16 units serialize as JSON numbers");
        let right = serde_json::to_string(right).expect("UTF-16 units serialize as JSON numbers");
        compare(&left, &right).cmp(&0)
    }

    fn uppercase(&self, value: &[u16]) -> Vec<u16> {
        let encoded = serde_json::to_string(value).expect("UTF-16 units serialize as JSON numbers");
        serde_json::from_str(&uppercase(&encoded))
            .expect("the packaged uppercase host returns a JSON UTF-16 array")
    }
}

/// Projects a lossless transient input and returns the unchanged public model shape through its wire envelope.
///
/// # Errors
/// Throws a JavaScript error if the input wire envelope is malformed.
#[wasm_bindgen]
pub fn project_wire_json(input_wire_json: &str) -> Result<String, JsValue> {
    project_with_host(input_wire_json, &BrowserSemantics)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
