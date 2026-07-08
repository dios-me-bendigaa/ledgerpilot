# Personal GitHub Setup

LedgerPilot keeps personal GitHub SSH wiring inside the project so work GitHub credentials stay untouched.

## Layout

- `.local/ssh/id_ed25519_github_personal`
- `.local/ssh/id_ed25519_github_personal.pub`
- `.local/ssh/config`

`.local/` is gitignored, so the private key never gets committed.

## Generate a project-local key

```bash
mkdir -p .local/ssh
ssh-keygen -t ed25519 -f .local/ssh/id_ed25519_github_personal -C "ledgerpilot-personal"
```

## SSH config for this repo

Create `.local/ssh/config` with:

```sshconfig
Host github-personal
  HostName github.com
  User git
  IdentityFile /Users/mohan.muppavarapu/Desktop/PA/Repos/ledgerpilot/.local/ssh/id_ed25519_github_personal
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

## Add the public key to GitHub

Upload the contents of `.local/ssh/id_ed25519_github_personal.pub` to your personal GitHub account.

## Tell git to use the repo-local SSH config

Run from the repo root:

```bash
git config core.sshCommand "ssh -F /Users/mohan.muppavarapu/Desktop/PA/Repos/ledgerpilot/.local/ssh/config"
```

## Remote URL

Use this remote so only this repo uses the personal key:

```bash
git remote add origin git@github-personal:dios-me-bendigaa/ledgerpilot.git
```
