const core = require('@actions/core');
const github = require('@actions/github');

try {
    const ref = github.context.ref;
    console.log(`Hello ${ref}!`);
    if (github.context.eventName === 'pull_request') {
        console.log("triggered on pull_request!");
    } else {
        core.setFailed("Can only be triggered on pull_request, current event=" +
            github.context.eventName)
    }
} catch (error) {
    core.setFailed(error.message);
}