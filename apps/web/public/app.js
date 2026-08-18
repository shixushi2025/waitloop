const runtimeStatus = document.querySelector("#runtime-status");

async function checkRuntime() {
  if (!(runtimeStatus instanceof HTMLElement)) {
    return;
  }

  try {
    const response = await fetch("/api/v1/health", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`health check failed: ${response.status}`);
    }

    runtimeStatus.textContent = "runtime online";
    runtimeStatus.classList.add("online");
    runtimeStatus.classList.remove("offline");
  } catch {
    runtimeStatus.textContent = "runtime offline";
    runtimeStatus.classList.add("offline");
    runtimeStatus.classList.remove("online");
  }
}

void checkRuntime();
