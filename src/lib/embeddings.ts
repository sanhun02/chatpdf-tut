import OpenAI from "openai";

const openai = new OpenAI();

export async function getEmbeddings(text: string) {
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-ada-002",
            input: text.replace(/\n/g, " "),
          });

        return response.data[0].embedding as number[];
    } catch (error) {
        console.log("error calling openai embeddings api", error);
        throw error;
    }
}
