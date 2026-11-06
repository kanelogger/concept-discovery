import runpy
from pathlib import Path
import unittest

tools = runpy.run_path(Path(__file__).resolve().parents[2] / "scripts/migrate-compact.py")
urls = tools["urls"]


class SourceRetention(unittest.TestCase):
    def test_structured_links_keep_parentheses_and_query_parameters(self):
        document = {"Type": "NodeParagraph", "Children": [
            {"Type": "NodeLinkDest", "Data": "https://example.org/wiki/Test_(en)"},
            {"Type": "NodeTextMark", "TextMarkAHref": "https://example.org/test?q=a&amp;b=2"},
        ]}
        self.assertEqual(urls([document]), {
            "https://example.org/wiki/Test_(en)", "https://example.org/test?q=a&b=2",
        })

    def test_plain_source_does_not_include_prose_delimiters(self):
        document = {"Type": "NodeText", "Data": "来源 (https://example.org/wiki/Test_(en))."}
        self.assertEqual(urls([document]), {"https://example.org/wiki/Test_(en)"})

    def test_rejects_invalid_structured_http_source(self):
        with self.assertRaises(ValueError):
            urls([{"Type": "NodeLinkDest", "Data": "https://"}])


if __name__ == "__main__":
    unittest.main()
