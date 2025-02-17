import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

import twit from 'twit';

import { ethers } from 'ethers';
import { hexToNumberString } from 'web3-utils';

import { firstValueFrom, map } from 'rxjs';

import dotenv from 'dotenv';
dotenv.config();

import looksRareABI from './abi/looksRareABI.json';

const alchemyAPIUrl = 'https://eth-mainnet.alchemyapi.io/v2/';
const alchemyAPIKey = process.env.ALCHEMY_API_KEY;

const tokenContractAddress = '0xf07468ead8cf26c752c676e43c814fee9c8cf402';
const looksRareAddress = '0x59728544b08ab483533076417fbbb2fd0b17ce3a'; // Don't change unless deprecated

const provider = new ethers.providers.JsonRpcProvider(alchemyAPIUrl + alchemyAPIKey);
const looksInterface = new ethers.utils.Interface(looksRareABI);

const twitterConfig = {
  consumer_key: process.env.TW_CONSUMER_KEY,
  consumer_secret: process.env.TW_CONSUMER_SECRET,
  access_token: process.env.TW_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TW_ACCESS_TOKEN_SECRET,
};

const twitterClient = new twit(twitterConfig);

@Injectable()
export class AppService {

  constructor(
    private readonly http: HttpService
  ) {

    // Listen for Transfer event
    provider.on({
      address: tokenContractAddress,
      // Transfer topic
      topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
    }, (tx) => {
      this.getTransactionDetails(tx).then((res) => {
        // Tweet
        console.log(res);
        if (res) this.tweet(res);
      });
    });

  }

  async getTransactionDetails(tx: any): Promise<any> {

    try {

      const { transactionHash } = tx;

      // Get transaction
      const transaction = await provider.getTransaction(transactionHash);
      const { value } = transaction;
      const ether = ethers.utils.formatEther(value.toString());

      // Get transaction receipt
      const receipt: any = await provider.getTransactionReceipt(transactionHash);
      const { from, to } = receipt;

      // Get tokenId from topics
      const tokenId = hexToNumberString(tx?.topics[3]);
      // Get token image
      const imageUrl = await this.getTokenMetadata(tokenId);

      // Check if LooksRare & parse the event & get the value
      let looksRareValue = 0;
      const LR = receipt.logs.map((log: any) => {
        if (log.address.toLowerCase() === looksRareAddress.toLowerCase()) {  
          return looksInterface.parseLog(log);
        }
      }).filter((log: any) => log?.name === 'TakerAsk');

      if (LR.length) {
        const weiValue = (LR[0]?.args?.price)?.toString();
        const value = ethers.utils.formatEther(weiValue);
        looksRareValue = parseFloat(value);
      }

      // Only return transfers with value (Ignore w2w transfers)
      if (parseFloat(ether) || looksRareValue) {
        return {
          from,
          to,
          tokenId,
          ether: parseFloat(ether),
          imageUrl,
          transactionHash,
          looksRareValue
        };
      }

      return null;

    } catch (err) {
      console.log(err);
      return null;
    }
    
  }

  async getTokenMetadata(tokenId: string): Promise<any> {
    const url = alchemyAPIUrl + alchemyAPIKey + '/getNFTMetadata';
    return await firstValueFrom(this.http.get(url, {
      params: {
        contractAddress: tokenContractAddress,
        tokenId,
        tokenType: 'erc721'
      }
    }).pipe(map((res: any) => {
      return res?.data?.metadata?.image_url || res?.data?.metadata?.image || res?.data?.tokenUri?.gateway;
    })));
  }

  async tweet(data: any) {

    // Replace this with a custom message
    const tweetText = `Phunk #${data.tokenId} just sold for ${data.ether ? data.ether : data.looksRareValue} -- https://etherscan.io/tx/${data.transactionHash}`;

    // Format our image to base64
    const processedImage = await this.getBase64(data.imageUrl);
  
    // Upload the item's image to Twitter & retrieve a reference to it
    twitterClient.post('media/upload', { media_data: processedImage }, (error, media: any, response) => {
      if (!error) {

        const tweet = { status: tweetText, media_ids: [media.media_id_string] };

        // Post the tweet 👇
        // If you need access to this endpoint, you’ll need to apply for Elevated access via the Developer Portal. You can learn more here: https://developer.twitter.com/en/docs/twitter-api/getting-started/about-twitter-api#v2-access-leve
        twitterClient.post('statuses/update', tweet, (error, tweet, response) => {
          if (!error) console.log(`Successfully tweeted: ${tweetText}`);
          else console.error(error);
        });
      }
      else console.error(error);
    });
  }

  async getBase64(url: string) {
    return await firstValueFrom(
      this.http.get(url, { responseType: 'arraybuffer' }).pipe(
        map((res) => Buffer.from(res.data, 'binary').toString('base64'))
      )
    );
  }

}
