//! Synthetic native checks exercise the public lossless projection boundary independently of Chrome.

use msa_deck_tracker_core::{project_with_host, HostSemantics};
use serde_json::{json, Value};
use std::cmp::Ordering;

#[derive(Debug)]
struct SyntheticHost;

impl HostSemantics for SyntheticHost {
    fn date_parse(&self, value_wire_json: &str) -> f64 {
        let wire: Value =
            serde_json::from_str(value_wire_json).expect("test host receives valid wire JSON");
        match decode(&wire).as_str() {
            Some("2000-01-01T00:00:00Z") => 0.0,
            Some("2000-01-02T00:00:00Z") => 86_400_000.0,
            _ => f64::NAN,
        }
    }

    fn compare(&self, left: &[u16], right: &[u16]) -> Ordering {
        // Fixtures deliberately use ASCII ordering. Production collation is supplied by JavaScript.
        left.cmp(right)
    }

    fn uppercase(&self, value: &[u16]) -> Vec<u16> {
        value
            .iter()
            .map(|unit| {
                if (97..=122).contains(unit) {
                    unit - 32
                } else {
                    *unit
                }
            })
            .collect()
    }
}

fn encode(value: &Value) -> Value {
    match value {
        Value::Object(entries) => {
            json!({"t":"object","v":entries.iter().map(|(key,value)|json!([key.encode_utf16().collect::<Vec<_>>(),encode(value)])).collect::<Vec<_>>()})
        }
        Value::Array(entries) => {
            json!({"t":"array","v":entries.iter().map(encode).collect::<Vec<_>>()})
        }
        Value::String(value) => json!({"t":"string","v":value.encode_utf16().collect::<Vec<_>>()}),
        Value::Number(value) => json!({"t":"number","v":value}),
        Value::Bool(value) => json!({"t":"bool","v":value}),
        Value::Null => json!({"t":"null"}),
    }
}

fn decode(wire: &Value) -> Value {
    match wire["t"].as_str().expect("wire values have tags") {
        "object" => Value::Object(
            wire["v"]
                .as_array()
                .expect("object has entries")
                .iter()
                .map(|entry| {
                    let key = String::from_utf16(&units(&entry[0]))
                        .expect("native fixture keys have valid UTF-16");
                    (key, decode(&entry[1]))
                })
                .collect(),
        ),
        "array" => Value::Array(
            wire["v"]
                .as_array()
                .expect("wire array has entries")
                .iter()
                .map(decode)
                .collect(),
        ),
        "string" => Value::String(
            String::from_utf16(&units(&wire["v"])).expect("native fixture string has valid UTF-16"),
        ),
        "number" | "bool" => wire["v"].clone(),
        "null" => Value::Null,
        tag => panic!("unexpected fixture tag {tag}"),
    }
}

fn units(value: &Value) -> Vec<u16> {
    value
        .as_array()
        .expect("UTF-16 units form an array")
        .iter()
        .map(|unit| {
            u16::try_from(unit.as_u64().expect("unit is an unsigned integer"))
                .expect("unit fits u16")
        })
        .collect()
}

fn project(input: &Value) -> Value {
    let wire = serde_json::to_string(&encode(input)).expect("fixture serializes");
    let output = project_with_host(&wire, &SyntheticHost).expect("synthetic projection succeeds");
    decode(&serde_json::from_str(&output).expect("projection returns wire JSON"))
}

fn deck() -> Value {
    json!({"schemaVersion":1,"id":"test-deck.v-1","deckId":"test-deck","name":"Synthetic 50","createdAt":"2000-01-01T00:00:00Z",
        "main":(1..=13).map(|index|json!({"cardCode":format!("GD99-{index:03}"),"count":if index==13 {2}else{4}})).collect::<Vec<_>>(),
        "resources":[{"cardCode":"R-001","count":10}],"tokens":[{"cardCode":"T-001","count":2}]})
}

fn input() -> Value {
    let snapshot = json!({"id":"snapshot-1","quality":"complete","expectedCount":2,"unknownCount":0,"hand":[{"cardCode":"GD99-001","count":2}]});
    json!({"context":{"gameId":"game-1","runId":"run-1","playerName":"Demo North"},
        "values":{"msa.session.game-1.run-1":{"schemaVersion":1,"id":"game-1.run-1","gameId":"game-1","playerName":"Demo North","snapshots":[snapshot.clone()]},
        "msa.deck.test-deck.v-1":deck(),"msa.match.match-1":{"schemaVersion":1,"id":"match-1","gameId":"game-1","playerName":"Demo North","source":"manual","identityConfirmed":true,"updatedAt":"2000-01-01T00:00:00Z","deckVersionId":"test-deck.v-1","frozenDeckVersion":deck(),"result":"unknown","resultConfirmed":false}},
        "handModel":{"sessionId":"game-1.run-1","quality":"complete","latestSnapshot":snapshot,"handCards":[{"cardCode":"GD99-001","count":2}]},
        "events":[],"players":["Demo North","Demo South"],"coverage":{"completeFromStart":true}})
}

#[test]
fn exact_partial_and_missing_hands_remain_distinct() {
    let mut data = input();
    let exact = project(&data);
    assert_eq!(exact["deck"]["mainCount"], json!(50.0));
    assert_eq!(exact["rows"][0]["handCount"], json!(2.0));
    assert_eq!(exact["rows"][1]["handCount"], json!(0.0));
    data["handModel"]["quality"] = json!("partial");
    let partial = project(&data);
    assert_eq!(partial["rows"][0]["handCountKind"], "at-least");
    assert_eq!(partial["rows"][1]["handCount"], Value::Null);
    data["handModel"]["latestSnapshot"]["sourceSessionId"] = json!("foreign-run");
    let absent = project(&data);
    assert!(absent["rows"]
        .as_array()
        .expect("model rows")
        .iter()
        .all(|row| row["handCount"] == Value::Null));
}

#[test]
fn public_occurrences_preserve_repeats_and_generated_tokens_separately() {
    let mut data = input();
    let mut events = (0..6).map(|_| json!({"action":"deploy-unit","isPlay":true,"actor":"Demo North","primaryCard":{"cardCode":"GD99-001","name":"Synthetic unit"}})).collect::<Vec<_>>();
    events.push(json!({"action":"deploy-token","isPlay":false,"actor":"Demo South","primaryCard":{"cardCode":"T-001","name":"Synthetic token"}}));
    events.push(json!({"action":"return-hand","isPlay":false,"actor":"Demo North","primaryCard":{"cardCode":"GD99-001"}}));
    data["events"] = json!(events);
    let output = project(&data);
    assert_eq!(output["rows"][0]["publicUseCount"], json!(6.0));
    assert_eq!(output["rows"][0]["deckCount"], json!(4.0));
    assert_eq!(output["publicCards"]["tokens"][0]["side"], "opponent");
    assert_eq!(output["publicCards"]["tokens"][0]["count"], json!(1.0));
    assert!(output["rows"]
        .as_array()
        .expect("model rows")
        .iter()
        .all(|row| row["cardCode"] != "T-001"));
}

#[test]
fn frozen_deck_is_used_and_invalid_frozen_data_never_falls_back() {
    let mut data = input();
    data["values"]["msa.deck.test-deck.v-1"]["name"] = json!("A later edit");
    assert_eq!(project(&data)["deck"]["name"], "Synthetic 50");
    data["values"]["msa.match.match-1"]["frozenDeckVersion"]["id"] = json!("wrong-version");
    let invalid = project(&data);
    assert_eq!(invalid["state"], "invalid");
    assert_eq!(invalid["deck"], Value::Null);
}

#[test]
fn latest_binding_and_unknown_results_do_not_resurrect_older_confirmations() {
    let mut data = input();
    let mut old = data["values"]["msa.match.match-1"].clone();
    old["id"] = json!("historical");
    old["gameId"] = json!("historical-game");
    old["result"] = json!("win");
    old["resultConfirmed"] = json!(true);
    data["values"]["msa.match.historical"] = old.clone();
    assert_eq!(project(&data)["stats"]["confirmed"], json!(1.0));
    old["id"] = json!("historical-later");
    old["updatedAt"] = json!("2000-01-02T00:00:00Z");
    old["result"] = json!("unknown");
    old["resultConfirmed"] = json!(false);
    data["values"]["msa.match.historical-later"] = old;
    assert_eq!(project(&data)["stats"]["confirmed"], json!(0.0));
    let mut unbind = data["values"]["msa.match.match-1"].clone();
    unbind["id"] = json!("later");
    unbind["updatedAt"] = json!("2000-01-02T00:00:00Z");
    unbind["deckVersionId"] = Value::Null;
    data["values"]["msa.match.later"] = unbind;
    assert_eq!(project(&data)["state"], "unbound");
}

#[test]
fn utf16_deck_lengths_and_truncated_surrogates_remain_lossless() {
    let mut data = input();
    let long_name = format!("{}😀", "A".repeat(299));
    data["events"] = json!([{"action":"deploy-unit","isPlay":true,"actor":"Demo South","primaryCard":{"cardCode":null,"name":long_name}}]);
    let encoded = serde_json::to_string(&encode(&data)).expect("fixture serializes");
    let output: Value = serde_json::from_str(
        &project_with_host(&encoded, &SyntheticHost).expect("projection succeeds"),
    )
    .expect("valid output wire");
    let field = |value: &Value, key: &str| {
        value["v"]
            .as_array()
            .expect("wire object")
            .iter()
            .find(|entry| units(&entry[0]) == key.encode_utf16().collect::<Vec<_>>())
            .expect("wire field exists")[1]
            .clone()
    };
    let groups = field(&output, "publicCards");
    let unknown = field(&groups, "unknown");
    let name = field(&unknown["v"][0], "name");
    let public_units = units(&name["v"]);
    assert_eq!(public_units.len(), 300);
    assert_eq!(public_units[299], 0xd83d);
    data["events"] = json!([]);
    data["values"]["msa.deck.test-deck.v-1"]["name"] = json!("😀".repeat(61));
    let available = project(&data);
    assert!(available["availableDecks"]
        .as_array()
        .expect("available array")
        .is_empty());
}

#[test]
fn malformed_wire_is_a_recoverable_error() {
    for invalid in [
        "not JSON",
        r#"{"t":"string","v":[65536]}"#,
        r#"{"t":"unknown"}"#,
    ] {
        assert!(
            project_with_host(invalid, &SyntheticHost).is_err(),
            "invalid envelope {invalid:?}"
        );
    }
    assert_eq!(project(&json!({}))["state"], "identity-unknown");
}

#[test]
fn backup_metadata_at_forty_original_levels_is_accepted() {
    let mut metadata = json!(null);
    for _ in 0..40 {
        metadata = json!({"child":metadata});
    }
    let mut data = input();
    data["metadata"] = metadata;
    assert_eq!(project(&data)["state"], "bound");
}

#[test]
fn structural_guard_rejects_deep_json_but_ignores_escaped_quoted_brackets() {
    let too_deep = format!("{}0{}", "[".repeat(513), "]".repeat(513));
    let error = project_with_host(&too_deep, &SyntheticHost).expect_err("too deeply nested");
    assert!(error.to_string().contains("512 JSON container levels"));
    let quoted_brackets = format!("\\\"{}\\\"", "[{".repeat(600));
    let value = json!({"t":"object","v":[],"ignored":quoted_brackets});
    assert!(project_with_host(&value.to_string(), &SyntheticHost).is_ok());
}
