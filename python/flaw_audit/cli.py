"""
FLAW CLI — Python wrapper for the FLAW TypeScript engine.
Requires Node.js >= 18 to be installed.
"""

import subprocess
import sys
import os
import shutil


def find_node():
    """Find the Node.js binary."""
    node = shutil.which("node")
    if node:
        return node
    # Common install locations
    for path in ["/usr/local/bin/node", "/opt/homebrew/bin/node", os.path.expanduser("~/.nvm/current/bin/node")]:
        if os.path.isfile(path):
            return path
    return None


def find_entry():
    """Find the FLAW JS entry point."""
    # Bundled dist/ alongside this package
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    bundled = os.path.join(pkg_dir, "dist", "index.js")
    if os.path.isfile(bundled):
        return bundled

    # Installed globally via npm
    npx = shutil.which("npx")
    if npx:
        return None  # Will use npx fallback

    return None


def main():
    """Main entry point for the FLAW CLI."""
    node = find_node()
    if not node:
        print("\033[31mError: Node.js >= 18 is required.\033[0m")
        print("Install it from https://nodejs.org or via your package manager.")
        print("")
        print("  brew install node        # macOS")
        print("  curl -fsSL https://fnm.vercel.app/install | bash  # fnm")
        print("  apt install nodejs       # Ubuntu/Debian")
        sys.exit(1)

    entry = find_entry()

    if entry:
        # Run bundled JS directly
        result = subprocess.run([node, entry] + sys.argv[1:])
        sys.exit(result.returncode)
    else:
        # Try npx fallback
        npx = shutil.which("npx")
        if npx:
            result = subprocess.run([npx, "flaw-kit"] + sys.argv[1:])
            sys.exit(result.returncode)

        print("\033[31mError: FLAW engine not found.\033[0m")
        print("Install via npm: npm install -g flaw-kit")
        sys.exit(1)


if __name__ == "__main__":
    main()
