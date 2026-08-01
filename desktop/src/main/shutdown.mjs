export function createShutdownCoordinator({
  clearMedia,
  quit,
  stopSupervisor,
}) {
  let allowQuit = false;
  let shutdownPromise;

  return {
    handleBeforeQuit(event) {
      if (allowQuit) {
        return;
      }
      event.preventDefault();
      if (shutdownPromise) {
        return;
      }

      shutdownPromise = Promise.allSettled([
        invokeCleanup(stopSupervisor),
        invokeCleanup(clearMedia),
      ]).then(() => {
        allowQuit = true;
        quit();
      });
    },
    whenFinished() {
      return shutdownPromise ?? Promise.resolve();
    },
  };
}

function invokeCleanup(operation) {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}
