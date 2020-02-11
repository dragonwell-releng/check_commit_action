const core = require('@actions/core');
const github = require('@actions/github');

try {
    const ref = github.context.ref;
    console.log(`Hello ${ref}!`);
} catch (error) {
    core.setFailed(error.message);
}