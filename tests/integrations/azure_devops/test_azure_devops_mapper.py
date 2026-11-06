"""
Unit Tests for Azure DevOps Work Item Mapper & HTML to Markdown Converter
=========================================================================

Tier 1 automated tests validating HTML parsing, markdown translation, title slugification,
and Auto Claude specification directory & schema generation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from apps.backend.integrations.azure_devops.mapper import (
    create_spec_from_work_item,
    html_to_markdown,
    slugify_title,
    work_item_to_auto_claude_spec,
)
from apps.backend.integrations.azure_devops.models import AzureDevOpsWorkItem


class TestHtmlToMarkdown:
    """Tests for HTML to clean Markdown parsing."""

    def test_basic_formatting(self) -> None:
        html_input = "<p>This is <b>bold</b> and <strong>strong</strong>, with <i>italic</i> and <em>emphasized</em> text.</p>"
        result = html_to_markdown(html_input)
        assert "**bold**" in result
        assert "**strong**" in result
        assert "*italic*" in result
        assert "*emphasized*" in result

    def test_inline_and_block_code(self) -> None:
        html_input = (
            "<p>Use the <code>get_work_item</code> function:</p>"
            "<pre><code>def example():\n    return 42</code></pre>"
        )
        result = html_to_markdown(html_input)
        assert "`get_work_item`" in result
        assert "```\ndef example():\n    return 42\n```" in result

    def test_pre_without_code_tag(self) -> None:
        html_input = "<pre>console.log('hello world');</pre>"
        result = html_to_markdown(html_input)
        assert "```\nconsole.log('hello world');\n```" in result

    def test_unordered_list(self) -> None:
        html_input = (
            "<p>Prerequisites:</p>"
            "<ul>"
            "<li>Python 3.10+</li>"
            "<li>Azure DevOps PAT token</li>"
            "<li>Git repository</li>"
            "</ul>"
        )
        result = html_to_markdown(html_input)
        assert "Prerequisites:" in result
        assert "- Python 3.10+" in result
        assert "- Azure DevOps PAT token" in result
        assert "- Git repository" in result

    def test_ordered_list(self) -> None:
        html_input = (
            "<ol>"
            "<li>Configure environment</li>"
            "<li>Run unit tests</li>"
            "<li>Deploy application</li>"
            "</ol>"
        )
        result = html_to_markdown(html_input)
        assert "1. Configure environment" in result
        assert "2. Run unit tests" in result
        assert "3. Deploy application" in result

    def test_hyperlinks(self) -> None:
        html_input = 'Please visit <a href="https://dev.azure.com/my-org">Azure DevOps Portal</a> for details.'
        result = html_to_markdown(html_input)
        assert "[Azure DevOps Portal](https://dev.azure.com/my-org)" in result

    def test_html_entities(self) -> None:
        html_input = "Crash in &lt;Transport&gt; &amp; &quot;Worker&quot; &apos;module&apos; &nbsp; with error &gt; 500."
        result = html_to_markdown(html_input)
        assert "<Transport>" in result
        assert "&" in result
        assert '"Worker"' in result
        assert "'module'" in result
        assert "> 500" in result

    def test_headings_and_paragraphs(self) -> None:
        html_input = "<h1>Main Heading</h1><p>First paragraph.</p><h2>Subheading</h2><p>Second paragraph.</p>"
        result = html_to_markdown(html_input)
        assert "# Main Heading" in result
        assert "## Subheading" in result
        assert "First paragraph." in result
        assert "Second paragraph." in result

    def test_line_breaks(self) -> None:
        html_input = "Line 1<br>Line 2<br/>Line 3"
        result = html_to_markdown(html_input)
        assert "Line 1\nLine 2\nLine 3" in result

    def test_empty_and_plain_text(self) -> None:
        assert html_to_markdown("") == ""
        assert html_to_markdown(None) == ""
        assert html_to_markdown("   ") == ""
        plain = "This is a simple plain text description without HTML."
        assert html_to_markdown(plain) == plain


class TestSlugifyTitle:
    """Tests for URL-friendly and filesystem-safe slug generation."""

    def test_standard_title(self) -> None:
        title = "Authentication Crash On Empty Token"
        slug = slugify_title(title)
        assert slug == "authentication-crash-on-empty-token"

    def test_punctuation_and_special_chars(self) -> None:
        title = "[CRITICAL Bug #401]: Can't connect to Dev/Ops & API!"
        slug = slugify_title(title)
        assert slug == "critical-bug-401-can-t-connect-to-dev-ops-api"

    def test_multiple_hyphens_and_spaces(self) -> None:
        title = "   ---Feature:   WIQL Query Builder---   "
        slug = slugify_title(title)
        assert slug == "feature-wiql-query-builder"

    def test_empty_or_symbol_only(self) -> None:
        assert slugify_title("") == "task"
        assert slugify_title(None) == "task"
        assert slugify_title("!!! ???") == "task"

    def test_length_capping(self) -> None:
        long_title = "A" * 100
        slug = slugify_title(long_title)
        assert len(slug) <= 60


class TestCreateSpecFromWorkItem:
    """Tests for Auto Claude specification artifacts generation."""

    @pytest.fixture
    def sample_work_item(self) -> AzureDevOpsWorkItem:
        return AzureDevOpsWorkItem(
            id=101,
            title="Authentication crash on empty token",
            description="<div>The authentication layer raises <b>unhandled</b> exception.<br>See logs.</div>",
            state="Active",
            work_item_type="Bug",
            priority=1,
            url="https://dev.azure.com/my-org/my-project/_workitems/edit/101",
            tags=["auth", "urgent", "backend"],
            raw_fields={"System.Id": 101},
        )

    def test_create_spec_from_work_item(self, tmp_path: Path, sample_work_item: AzureDevOpsWorkItem) -> None:
        spec_dir = create_spec_from_work_item(
            work_item=sample_work_item,
            base_dir=tmp_path,
            spec_number=1,
        )

        assert spec_dir.exists()
        assert spec_dir.name == "001-authentication-crash-on-empty-token"

        # Check spec.md
        spec_file = spec_dir / "spec.md"
        assert spec_file.exists()
        spec_md = spec_file.read_text(encoding="utf-8")
        assert "# Authentication crash on empty token" in spec_md
        assert "**unhandled**" in spec_md
        assert "#101" in spec_md
        assert "Bug" in spec_md
        assert "Active" in spec_md
        assert "auth, urgent, backend" in spec_md
        assert "Acceptance Criteria" in spec_md

        # Check requirements.json
        req_file = spec_dir / "requirements.json"
        assert req_file.exists()
        req_data = json.loads(req_file.read_text(encoding="utf-8"))
        assert req_data["workflow_type"] == "bugfix"
        assert req_data["priority"] == 1
        assert req_data["source"] == "azure_devops"
        assert req_data["work_item_id"] == 101
        assert "**unhandled**" in req_data["task_description"]

        # Check task_metadata.json
        meta_file = spec_dir / "task_metadata.json"
        assert meta_file.exists()
        meta_data = json.loads(meta_file.read_text(encoding="utf-8"))
        assert meta_data["sourceType"] == "azure_devops"
        assert meta_data["azureDevOpsId"] == 101
        assert meta_data["url"] == sample_work_item.url
        assert meta_data["state"] == "Active"
        assert meta_data["tags"] == ["auth", "urgent", "backend"]
        assert meta_data["workItemType"] == "Bug"

        # Check .azure_devops_task.json
        tracker_file = spec_dir / ".azure_devops_task.json"
        assert tracker_file.exists()
        tracker_data = json.loads(tracker_file.read_text(encoding="utf-8"))
        assert tracker_data["work_item_id"] == 101
        assert tracker_data["status"] == "pending"

    def test_work_item_to_auto_claude_spec_contract(self, tmp_path: Path, sample_work_item: AzureDevOpsWorkItem) -> None:
        target_dir = tmp_path / "custom-spec-042"
        summary = work_item_to_auto_claude_spec(sample_work_item, target_dir)

        assert summary["spec_id"] == "custom-spec-042"
        assert summary["work_item_id"] == 101
        assert (target_dir / "spec.md").exists()
        assert (target_dir / "requirements.json").exists()
        assert (target_dir / "task_metadata.json").exists()
