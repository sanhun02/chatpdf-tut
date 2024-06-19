import { Pinecone, PineconeRecord } from "@pinecone-database/pinecone";
import { downloadFromS3 } from "./s3-server";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import {
    Document,
    RecursiveCharacterTextSplitter,
} from "@pinecone-database/doc-splitter";
import { getEmbeddings } from "./embeddings";
import md5 from "md5";
import { metadata } from "@/app/layout";
import { convertToAscii } from "./utils";

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

type PDFPage = {
    pageContent: string;
    metadata: {
        loc: { pageNumber: number };
    };
};

const chunks = <T>(array: T[], batchSize: number): T[][] => {
    const chunkedArray: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
        chunkedArray.push(array.slice(i, i + batchSize));
    }
    return chunkedArray;
};

export async function loadS3IntoPinecone(fileKey: string) {
    console.log("downloading s3 into file system");

    const file_name = await downloadFromS3(fileKey);

    if (!file_name) {
        throw new Error("could not download from s3");
    }

    const loader = new PDFLoader(file_name);
    const pages = (await loader.load()) as PDFPage[];

    const documents = await Promise.all(pages.map(prepareDocument));

    const vectors = (
        await Promise.all(documents.flat().map(embedDocument))
    ).filter((vector): vector is PineconeRecord => vector !== undefined);

    const pineconeIndex = pinecone.index("chatpdf");
    console.log("inserting vectors into pinecone");
    const namespace = convertToAscii(fileKey);

    const vectorChunks = chunks(vectors, 10);
    for (const chunk of vectorChunks) {
        await pineconeIndex.namespace(namespace).upsert(chunk);
    }

    return documents[0];
}

async function embedDocument(doc: Document) {
    try {
        const embeddings = await getEmbeddings(doc.pageContent);
        const hash = md5(doc.pageContent);

        return {
            id: hash,
            values: embeddings,
            metadata: {
                text: doc.metadata.text,
                pageNumber: doc.metadata.pageNumber,
            },
        } as PineconeRecord;
    } catch (error) {
        console.log("error embedding documents", error);
    }
}

export const truncateStringByBytes = (str: string, bytes: number) => {
    const enc = new TextEncoder();
    return new TextDecoder("utf-8").decode(enc.encode(str).slice(0, bytes));
};

export async function prepareDocument(page: PDFPage) {
    let { pageContent, metadata } = page;

    pageContent = pageContent.replace(/\n/g, "");

    const splitter = new RecursiveCharacterTextSplitter();
    const docs = await splitter.splitDocuments([
        new Document({
            pageContent,
            metadata: {
                pageNumber: metadata.loc.pageNumber,
                text: truncateStringByBytes(pageContent, 36000),
            },
        }),
    ]);

    return docs;
}
