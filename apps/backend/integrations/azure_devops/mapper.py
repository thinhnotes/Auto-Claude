"""
Azure DevOps Work Item Mapper & HTML to Markdown Converter
==========================================================

Converts Azure DevOps HTML descriptions into clean Markdown, normalizes titles
into filesystem-safe slugs, and generates Auto Claude specification files:
- spec.md
- requirements.json
- task_metadata.json
- .azure_devops_task.json
"""

from __future__ import annotations

import html
import json
import logging
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .models import AzureDevOpsWorkItem

logger = logging.getLogger(__name__)


# ============================================================================
# HTML TO MARKDOWN PARSER
# ============================================================================

class _HTMLToMarkdownParser(HTMLParser):
    """
    Parser translating Azure DevOps HTML rich-text into clean Markdown.

    Handles:
      - Block tags: <div>, <p>, <h1>-<h6>, <blockquote>
      - Formatting tags: <b>, <strong>, <i>, <em>, <code>, <pre>
      - Line breaks: <br>, <br/>
      - Lists: <ul>, <ol>, <li> (with proper indentation & numbering)
      - Hyperlinks: <a href="...">text</a> -> [text](href)
      - Entities: &nbsp;, &lt;, &gt;, &amp;, &quot;, &#39;, etc.
    """

    def __init__(self) -> None:
        super().__init__()
        self.output: List[str] = []
        self.tag_stack: List[Tuple[str, Dict[str, str]]] = []
        self.list_stack: List[Tuple[str, int]] = []  # ("ul" | "ol", counter)
        self.in_pre: bool = False
        self.in_code: bool = False
        self.current_link_href: Optional[str] = None
        self.current_link_text: List[str] = []

    def _ensure_newline(self, count: int = 1) -> None:
        """Ensure current output buffer ends with at least count newlines."""
        if not self.output:
            return
        last_str = "".join(self.output)
        newlines_at_end = len(last_str) - len(last_str.rstrip("\n"))
        needed = count - newlines_at_end
        if needed > 0:
            self.output.append("\n" * needed)

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        attrs_dict = {k: v or "" for k, v in attrs}
        self.tag_stack.append((tag, attrs_dict))

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self._ensure_newline(2)
            self.output.append("#" * level + " ")
        elif tag in ("p", "div"):
            self._ensure_newline(1)
        elif tag == "br":
            self.output.append("\n")
        elif tag in ("b", "strong"):
            self.output.append("**")
        elif tag in ("i", "em"):
            self.output.append("*")
        elif tag == "pre":
            self._ensure_newline(1)
            self.in_pre = True
            self.output.append("```\n")
        elif tag == "code":
            self.in_code = True
            if not self.in_pre:
                self.output.append("`")
        elif tag == "ul":
            self._ensure_newline(1)
            self.list_stack.append(("ul", 0))
        elif tag == "ol":
            self._ensure_newline(1)
            self.list_stack.append(("ol", 1))
        elif tag == "li":
            self._ensure_newline(1)
            indent_level = max(0, len(self.list_stack) - 1)
            indent = "  " * indent_level
            if self.list_stack:
                list_type, counter = self.list_stack[-1]
                if list_type == "ol":
                    self.output.append(f"{indent}{counter}. ")
                    self.list_stack[-1] = (list_type, counter + 1)
                else:
                    self.output.append(f"{indent}- ")
            else:
                self.output.append("- ")
        elif tag == "a":
            self.current_link_href = attrs_dict.get("href", "")
            self.current_link_text = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._ensure_newline(1)
        elif tag in ("p", "div"):
            self._ensure_newline(1)
        elif tag in ("b", "strong"):
            self.output.append("**")
        elif tag in ("i", "em"):
            self.output.append("*")
        elif tag == "pre":
            self.in_pre = False
            self._ensure_newline(1)
            self.output.append("```\n")
        elif tag == "code":
            self.in_code = False
            if not self.in_pre:
                self.output.append("`")
        elif tag in ("ul", "ol"):
            if self.list_stack:
                self.list_stack.pop()
            self._ensure_newline(1)
        elif tag == "li":
            self._ensure_newline(1)
        elif tag == "a":
            link_text = "".join(self.current_link_text).strip()
            href = self.current_link_href or ""
            if href:
                self.output.append(f"[{link_text}]({href})")
            else:
                self.output.append(link_text)
            self.current_link_href = None
            self.current_link_text = []

        # Pop from tag stack
        for i in range(len(self.tag_stack) - 1, -1, -1):
            if self.tag_stack[i][0] == tag:
                self.tag_stack.pop(i)
                break

    def handle_data(self, data: str) -> None:
        if self.current_link_href is not None:
            self.current_link_text.append(data)
        else:
            self.output.append(data)

    def handle_entityref(self, name: str) -> None:
        val = html.unescape(f"&{name};")
        self.handle_data(val)

    def handle_charref(self, name: str) -> None:
        val = html.unescape(f"&#{name};")
        self.handle_data(val)


def html_to_markdown(html_text: Optional[str]) -> str:
    """
    Convert Azure DevOps HTML rich-text to clean Markdown.

    Args:
        html_text: Raw HTML string or plain text.

    Returns:
        Clean, formatted Markdown string.
    """
    if not html_text:
        return ""

    raw = str(html_text).strip()
    if not raw:
        return ""

    # Quick path if string has no HTML tags
    if "<" not in raw and ">" not in raw:
        return html.unescape(raw)

    parser = _HTMLToMarkdownParser()
    try:
        parser.feed(raw)
        parser.close()
        result = "".join(parser.output)
    except Exception as exc:
        logger.warning(f"Error parsing HTML to markdown: {exc}; falling back to regex tag strip.")
        # Fallback to regex tag stripper
        result = re.sub(r"<[^>]+>", " ", raw)
        result = html.unescape(result)

    # Clean up whitespace per line and collapse excessive newlines
    lines = [line.rstrip() for line in result.split("\n")]
    cleaned = "\n".join(lines)
    # Collapse 3 or more newlines to at most 2
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# ============================================================================
# SLUGIFY
# ============================================================================

def slugify_title(title: Optional[str]) -> str:
    """
    Create a URL-friendly, filesystem-safe slug from a work item title.

    Args:
        title: Raw title string.

    Returns:
        Slugified string (e.g. 'authentication-crash-on-empty-token').
    """
    if not title:
        return "task"

    text = str(title).strip().lower()
    # Replace non-alphanumeric characters with hyphens
    slug = re.sub(r"[^a-z0-9]+", "-", text)
    # Strip leading and trailing hyphens
    slug = slug.strip("-")

    if not slug:
        return "task"

    # Limit length to 60 characters
    return slug[:60].rstrip("-")


# ============================================================================
# SPEC CREATION
# ============================================================================

def create_spec_from_work_item(
    work_item: AzureDevOpsWorkItem,
    base_dir: Path,
    spec_number: int = 1,
) -> Path:
    """
    Generate Auto Claude spec directory and specification artifacts from an Azure DevOps work item.

    Creates:
      - spec directory: ${base_dir}/${spec_number:03d}-${slug}
      - spec.md: specification overview, title, description, work item metadata, acceptance criteria
      - requirements.json: structured task requirements
      - task_metadata.json: source metadata linking back to Azure DevOps
      - .azure_devops_task.json: task sync tracker

    Args:
        work_item: Ingested AzureDevOpsWorkItem.
        base_dir: Base directory where specs live (e.g. .auto-claude/specs).
        spec_number: Sequential number for spec folder prefix.

    Returns:
        Path to the created spec directory.
    """
    base_dir = Path(base_dir)
    base_dir.mkdir(parents=True, exist_ok=True)

    slug = slugify_title(work_item.title)
    spec_dir_name = f"{spec_number:03d}-{slug}"
    spec_dir = base_dir / spec_dir_name
    spec_dir.mkdir(parents=True, exist_ok=True)

    # Convert description to clean Markdown
    description_md = html_to_markdown(work_item.description)

    # 1. Generate spec.md
    tags_str = ", ".join(work_item.tags) if work_item.tags else "None"
    spec_content = f"""# {work_item.title}

## Overview
{description_md if description_md else "No description provided."}

## Work Item Metadata
- **Work Item ID**: #{work_item.id}
- **Type**: {work_item.work_item_type}
- **Current State**: {work_item.state}
- **Priority**: {work_item.priority}
- **URL**: {work_item.url}
- **Tags**: {tags_str}

## Acceptance Criteria
- [ ] Implement required functionality or fix described in work item #{work_item.id}
- [ ] Verify unit and integration test suite passes without regressions
- [ ] Maintain git branch/worktree isolation during execution
- [ ] Report execution summary and test results back to Azure DevOps
"""
    (spec_dir / "spec.md").write_text(spec_content, encoding="utf-8")

    # 2. Generate requirements.json
    workflow_type = "bugfix" if work_item.work_item_type.lower() == "bug" else "feature"
    requirements_data = {
        "task_description": description_md,
        "workflow_type": workflow_type,
        "priority": work_item.priority,
        "source": "azure_devops",
        "work_item_id": work_item.id,
        "title": work_item.title,
    }
    (spec_dir / "requirements.json").write_text(
        json.dumps(requirements_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    # 3. Generate task_metadata.json
    task_metadata_data = {
        "sourceType": "azure_devops",
        "azureDevOpsId": work_item.id,
        "url": work_item.url,
        "state": work_item.state,
        "tags": work_item.tags,
        "priority": work_item.priority,
        "workItemType": work_item.work_item_type,
        "title": work_item.title,
    }
    (spec_dir / "task_metadata.json").write_text(
        json.dumps(task_metadata_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    # 4. Generate .azure_devops_task.json for execution and sync tracking
    tracking_data = {
        "work_item_id": work_item.id,
        "title": work_item.title,
        "initial_state": work_item.state,
        "url": work_item.url,
        "status": "pending",
        "spec_id": spec_dir_name,
    }
    (spec_dir / ".azure_devops_task.json").write_text(
        json.dumps(tracking_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    logger.info(f"Created Auto Claude spec for Azure DevOps #{work_item.id} at {spec_dir}")
    return spec_dir


def work_item_to_auto_claude_spec(
    work_item: AzureDevOpsWorkItem,
    spec_dir: Path,
) -> Dict[str, Any]:
    """
    Interface contract function translating AzureDevOpsWorkItem to Auto Claude spec in target directory.

    Args:
        work_item: AzureDevOpsWorkItem instance.
        spec_dir: Specific directory where spec files should be written.

    Returns:
        Dict summarizing created spec details.
    """
    spec_dir = Path(spec_dir)
    spec_dir.mkdir(parents=True, exist_ok=True)

    description_md = html_to_markdown(work_item.description)
    tags_str = ", ".join(work_item.tags) if work_item.tags else "None"

    spec_content = f"""# {work_item.title}

## Overview
{description_md if description_md else "No description provided."}

## Work Item Metadata
- **Work Item ID**: #{work_item.id}
- **Type**: {work_item.work_item_type}
- **Current State**: {work_item.state}
- **Priority**: {work_item.priority}
- **URL**: {work_item.url}
- **Tags**: {tags_str}

## Acceptance Criteria
- [ ] Implement changes described in work item #{work_item.id}
- [ ] Verify test suite passes without regressions
- [ ] Synchronize final execution status back to Azure DevOps
"""
    (spec_dir / "spec.md").write_text(spec_content, encoding="utf-8")

    workflow_type = "bugfix" if work_item.work_item_type.lower() == "bug" else "feature"
    requirements_data = {
        "task_description": description_md,
        "workflow_type": workflow_type,
        "priority": work_item.priority,
        "source": "azure_devops",
        "work_item_id": work_item.id,
        "title": work_item.title,
    }
    (spec_dir / "requirements.json").write_text(
        json.dumps(requirements_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    task_metadata_data = {
        "sourceType": "azure_devops",
        "azureDevOpsId": work_item.id,
        "url": work_item.url,
        "state": work_item.state,
        "tags": work_item.tags,
        "priority": work_item.priority,
        "workItemType": work_item.work_item_type,
        "title": work_item.title,
    }
    (spec_dir / "task_metadata.json").write_text(
        json.dumps(task_metadata_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    tracking_data = {
        "work_item_id": work_item.id,
        "title": work_item.title,
        "initial_state": work_item.state,
        "url": work_item.url,
        "status": "pending",
        "spec_id": spec_dir.name,
    }
    (spec_dir / ".azure_devops_task.json").write_text(
        json.dumps(tracking_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return {
        "spec_id": spec_dir.name,
        "spec_dir": str(spec_dir),
        "work_item_id": work_item.id,
        "title": work_item.title,
        "files": ["spec.md", "requirements.json", "task_metadata.json", ".azure_devops_task.json"],
    }
