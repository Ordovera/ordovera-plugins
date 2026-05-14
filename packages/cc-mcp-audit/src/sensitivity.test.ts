import { describe, it, expect } from "vitest";
import { _classifySensitivity, _matchesAtBoundary } from "./extract.js";

describe("matchesAtBoundary", () => {
  it("matches keyword at start of string", () => {
    expect(_matchesAtBoundary("password_reset", "password")).toBe(true);
  });

  it("matches keyword at end of string", () => {
    expect(_matchesAtBoundary("get_password", "password")).toBe(true);
  });

  it("matches keyword between underscores", () => {
    expect(_matchesAtBoundary("get_patient_records", "patient")).toBe(true);
  });

  it("matches keyword between hyphens", () => {
    expect(_matchesAtBoundary("get-api-key-value", "api_key")).toBe(false);
    expect(_matchesAtBoundary("get-credential-store", "credential")).toBe(true);
  });

  it("matches keyword between spaces", () => {
    expect(_matchesAtBoundary("retrieve patient data", "patient")).toBe(true);
  });

  it("rejects keyword embedded in larger word", () => {
    expect(_matchesAtBoundary("secretarial_duties", "secret")).toBe(false);
  });

  it("rejects keyword as prefix of longer word", () => {
    expect(_matchesAtBoundary("passwords_manager", "password")).toBe(false);
  });

  it("rejects keyword as suffix of longer word", () => {
    expect(_matchesAtBoundary("nonmedical_review", "medical")).toBe(false);
  });

  it("matches keyword at dot boundary", () => {
    expect(_matchesAtBoundary("auth.credential.get", "credential")).toBe(true);
  });

  it("matches keyword at colon boundary", () => {
    expect(_matchesAtBoundary("db:password:rotate", "password")).toBe(true);
  });

  it("handles camelCase boundary", () => {
    expect(_matchesAtBoundary("getPatientRecords", "Patient")).toBe(true);
  });

  it("matches exact string", () => {
    expect(_matchesAtBoundary("password", "password")).toBe(true);
  });

  it("rejects when keyword not present at all", () => {
    expect(_matchesAtBoundary("list_items", "password")).toBe(false);
  });
});

describe("classifySensitivity", () => {
  describe("data-domain keywords (confidentiality)", () => {
    it("detects PII keywords", () => {
      const result = _classifySensitivity("get_patient_records retrieve medical data");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivityCategory).toBe("confidentiality");
      expect(result.sensitivitySignals).toContain("patient");
      expect(result.sensitivitySignals).toContain("medical");
    });

    it("detects credential keywords", () => {
      const result = _classifySensitivity("read_api_key from vault");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivityCategory).toBe("confidentiality");
      expect(result.sensitivitySignals).toContain("api_key");
    });

    it("detects password keyword", () => {
      const result = _classifySensitivity("get_password_hash for user");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("password");
    });

    it("detects financial data keywords", () => {
      const result = _classifySensitivity("fetch_salary_data compensation report");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("salary");
    });

    it("detects regulatory keywords", () => {
      const result = _classifySensitivity("hipaa_audit_report compliance");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("hipaa");
    });
  });

  describe("action-scope keywords (autonomy/integrity)", () => {
    it("detects financial transaction keywords as autonomy", () => {
      const result = _classifySensitivity("process_payment for order");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivityCategory).toBe("autonomy");
      expect(result.sensitivitySignals).toContain("payment");
    });

    it("detects code execution keywords as integrity", () => {
      const result = _classifySensitivity("run_shell execute command");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivityCategory).toBe("integrity");
      expect(result.sensitivitySignals).toContain("run_shell");
    });

    it("detects eval as integrity", () => {
      const result = _classifySensitivity("eval expression in sandbox");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivityCategory).toBe("integrity");
    });

    it("detects infrastructure lifecycle keywords", () => {
      const result = _classifySensitivity("drop_database permanently");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("drop_database");
    });
  });

  describe("context-dependent pairs", () => {
    it("flags config + secret as sensitive", () => {
      const result = _classifySensitivity("get_config fetch secret values");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("config+secret");
    });

    it("does NOT flag config alone as sensitive", () => {
      const result = _classifySensitivity("get_config load display settings");
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("flags admin + permission as sensitive", () => {
      const result = _classifySensitivity("admin_panel manage permission settings");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("admin+permission");
    });

    it("does NOT flag admin alone as sensitive", () => {
      const result = _classifySensitivity("admin_dashboard view metrics");
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("flags session + token as sensitive", () => {
      const result = _classifySensitivity("get_session retrieve token for user");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("session+token");
    });

    it("flags environment + variable as sensitive", () => {
      const result = _classifySensitivity("read_environment list variable values");
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("environment+variable");
    });
  });

  describe("category priority", () => {
    it("confidentiality takes priority over autonomy when both present", () => {
      const result = _classifySensitivity("get_patient_data process_payment");
      expect(result.sensitivityCategory).toBe("confidentiality");
      expect(result.sensitivitySignals.length).toBeGreaterThan(1);
    });

    it("first action-scope match wins category within the group", () => {
      // "payment" appears before "run_shell" in SENSITIVE_ACTION_KEYWORDS,
      // so autonomy is assigned even though an integrity keyword also matches
      const result = _classifySensitivity("run_shell send_payment_notification");
      expect(result.sensitivityCategory).toBe("autonomy");
      // Both signals are captured regardless of which sets the category
      expect(result.sensitivitySignals).toContain("payment");
      expect(result.sensitivitySignals).toContain("run_shell");
    });
  });

  describe("non-sensitive classification", () => {
    it("classifies generic read tool as non-sensitive", () => {
      const result = _classifySensitivity("list_items get all items");
      expect(result.sensitivity).toBe("non-sensitive");
      expect(result.sensitivityCategory).toBeNull();
      expect(result.sensitivitySignals).toEqual([]);
    });

    it("classifies generic write tool as non-sensitive", () => {
      const result = _classifySensitivity("create_note add a new note");
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("does not match partial words", () => {
      const result = _classifySensitivity("secretarial_task manage schedules");
      expect(result.sensitivity).toBe("non-sensitive");
    });
  });

  describe("openWorldHint interaction", () => {
    it("does NOT classify as sensitive with openWorldHint alone", () => {
      const result = _classifySensitivity("list_items get items", {
        openWorldHint: true,
      });
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("keeps sensitive when openWorldHint is present WITH other signals", () => {
      const result = _classifySensitivity("get_patient_data from remote", {
        openWorldHint: true,
      });
      expect(result.sensitivity).toBe("sensitive");
      expect(result.sensitivitySignals).toContain("patient");
    });

    it("does NOT demote sensitive to non-sensitive when openWorldHint is false", () => {
      const result = _classifySensitivity("get_password hash from store", {
        openWorldHint: false,
      });
      expect(result.sensitivity).toBe("sensitive");
    });
  });

  describe("boundary matching prevents false positives", () => {
    it("'secret' does not match 'secretary'", () => {
      const result = _classifySensitivity("contact_secretary schedule meeting");
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("'medical' does not match 'nonmedical'", () => {
      const result = _classifySensitivity("get_nonmedical_supplies list");
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("'payment' does not match 'overpayment_check'", () => {
      // 'overpayment' should not trigger since 'payment' is embedded after 'over'
      const result = _classifySensitivity("check_overpayment status");
      expect(result.sensitivity).toBe("non-sensitive");
    });

    it("'password' does not match 'passwords_count'", () => {
      const result = _classifySensitivity("count_passwords total");
      expect(result.sensitivity).toBe("non-sensitive");
    });
  });
});
