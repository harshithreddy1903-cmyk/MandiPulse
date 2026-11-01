"""Check the serverless bridge without reading settings or calling services."""
import importlib.util
from pathlib import Path
from types import ModuleType
import unittest
from unittest.mock import patch


class VercelEntrypointTests(unittest.TestCase):
    def test_entrypoint_exports_existing_application_unchanged(self):
        root = Path(__file__).resolve().parents[2]
        sentinel = object()
        backend = ModuleType("backend")
        backend.__path__ = []
        package = ModuleType("backend.app")
        package.__path__ = []
        module = ModuleType("backend.app.main")
        module.app = sentinel
        with patch.dict("sys.modules", {"backend": backend, "backend.app": package, "backend.app.main": module}):
            spec = importlib.util.spec_from_file_location("mandipulse_vercel_entry", root / "api" / "index.py")
            entry = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(entry)
        self.assertIs(entry.app, sentinel)
        self.assertEqual((root / "requirements.txt").read_text(encoding="utf-8").strip(), "-r backend/requirements.txt")


if __name__ == "__main__":
    unittest.main()
