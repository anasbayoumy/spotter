const allowedNamedUsers = new Set(["node", "nonroot"]);

function isNonRootIdentity(identity) {
  const [user, group, extra] = identity.split(":");
  if (extra !== undefined || user === undefined || user.length === 0) return false;

  const safeUser = allowedNamedUsers.has(user) || /^[1-9]\d*$/u.test(user);
  const safeGroup =
    group === undefined || allowedNamedUsers.has(group) || /^[1-9]\d*$/u.test(group);
  return safeUser && safeGroup;
}

export function hasExplicitNonRootRuntimeUser(dockerfile) {
  let sawStage = false;
  let runtimeUser;

  for (const rawLine of dockerfile.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    if (/^FROM\s+/iu.test(line)) {
      sawStage = true;
      runtimeUser = undefined;
      continue;
    }
    if (!sawStage) continue;

    const match = /^USER\s+(\S+)\s*$/iu.exec(line);
    if (match !== null) runtimeUser = match[1];
  }

  return runtimeUser !== undefined && isNonRootIdentity(runtimeUser);
}
