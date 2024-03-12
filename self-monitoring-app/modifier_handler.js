exports.handler = async (event, context, callback) => {

    console.log('\n event:', JSON.stringify(event))
    console.log(`\n process: ${JSON.stringify(process.env)}`)

    return `✅ Hi dog.`;
};
