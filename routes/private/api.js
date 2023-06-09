const { isEmpty, times } = require("lodash");
const { v4 } = require("uuid");
const db = require("../../connectors/db");
const roles = require("../../constants/roles");
const { getSessionToken } = require('../../utils/session')
const getUser = async function (req) {
  const sessionToken = getSessionToken(req);
  if (!sessionToken) {
    return res.status(301).redirect("/");
  }
  console.log("hi",sessionToken);
  const user = await db
    .select("*")
    .from("se_project.sessions")
    .where("token", sessionToken)
    .innerJoin(
      "se_project.users",
      "se_project.sessions.userid",
      "se_project.users.id"
    )
    .innerJoin(
      "se_project.roles",
      "se_project.users.roleid",
      "se_project.roles.id"
    )
    .first();

  // console.log("user =>", user);
  user.isNormal = user.roleid === roles.user;
  user.isAdmin = user.roleid === roles.admin;
  user.isSenior = user.roleid === roles.senior;
  // console.log("user =>", user)
  return user;
};

module.exports = function (app) {
  // example
  app.get("/users", async function (req, res) {
    try {
      const user = await getUser(req);
      const users = await db.select('*').from("se_project.users")

      return res.status(200).json(users);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not get users");
    }

  });
//senior request (user) (Tested)
app.post("/api/v1/senior/request", async function (req, res) {
    try {
      const { nationalid } = req.body;
      const user = await getUser(req);
  
      const seniorRequest = {
        nationalid: nationalid,
        status: "pending",
        userid: user.id
      };
  
      await db("se_project.senior_requests").insert(seniorRequest).returning("*");
      
      return res.status(200).send("Senior request has been added successfully");
    } catch (error) {
      console.error(error.message);
      return res.status(400).send("Could not add nationalId");
    }
});
//reset password (Tested)
app.put("/api/v1/password/reset",async function(req,res){
    try{
      const {newPassword } = req.body;
      const user = await getUser(req);
      const useridn = user.userid;
      
      await db("se_project.users")
        .where("id", useridn)
        .update({ password: newPassword });
      return res.status(200).send("Password reset successfully");
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not reset password");
    }
  });

  //subscriptions using zones db(get) (Tested)
  app.get("/api/v1/zones", async function (req, res) {
    try {
      const zones = await db.select("*").from("se_project.zones");
      return res.status(200).json(zones);

    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not get zones");
    }
  });

  app.post("/api/v1/payment/subscription", async function (req, res) {
    try {
      const user = await getUser(req);
      const { purchaseid, creditcardnumber, holdername, payedamount, subtype, zoneid } = req.body;
      const transaction = { amount: payedamount, userid: user.userid, purchaseid: purchaseid };
      const [transactionid] = await db("se_project.transactions").insert(transaction).returning("id");
      let numOftickets = 0;
      if (subtype == "monthly") {
        numOftickets = 10;
      } else if (subtype == "quarterly") {
        numOftickets = 50;
      } else if (subtype == "yearly") {
        numOftickets = 100;
      }
      const subscription = { subtype: subtype, zoneid: zoneid, userid: user.userid, numOftickets };
      const [subscriptionid] = await db("se_project.subsription").insert(subscription).returning("id");
      return res.status(200).json({ transactionid, subscriptionid });
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not subscribe");
    }
  });

  //tickets: POST for pay for ticket by subscription (Tested)
  app.post("/api/v1/tickets/purchase/subscription", async function (req, res) {
    try {
      const user = await getUser(req);
      const {subid, origin, destination, tripdate} = req.body;
      const subscription = await db.select("*").from("se_project.substription").where("subscriptionid", subid).andWhere("userid", user.id);
      const ticket = {origin, destination, userid: user.id, tripdate: tripdate, subscriptionid: subid};
      const [ticketid] = await db("se_project.tickets").insert(ticket).returning("id");
      return res.status(200).json({ticketid});
  }catch(e){
      console.log(e.message);
      return res.status(400).send("Could not purchase ticket");
  }
});


// manageRequests(admin): accept/reject refund request (Tested)
app.put("/api/v1/requests/refunds/:requestid", async function (req, res) {
  try {
    const user = await getUser(req);
    if (user.isAdmin) {
      console.log(user.roleid);
      const { refundstatus } = req.body;
      const { requestid } = req.params;
      const refundrequest = await db("se_project.refund_requests").where("id", requestid).first();
      const ticketid = refundrequest.ticketid;
      console.log(ticketid);
      console.log(requestid);
      if (refundstatus === "Accept") {
        console.log(refundstatus);
        const subid = await db("se_project.tickets").where("id", ticketid).select("subid").first();
        const transactionid = await db("se_project.tickets").where("id", ticketid).select("purchaseid").first();
        if (subid && ticketid === subid.subid) { // if ticket is subscription
          const deletesubride = await db("se_project.tickets").where("subid", subid.subid).del();
          const ticketamount = await db("se_project.tickets").where("subid", subid.subid).select("nooftickets").first();
          // Update the ticketamount logic as per your requirements
          ticketamount.nooftickets = ticketamount.nooftickets + 1;
          // Update the ticketamount back to the database
          await db("se_project.tickets").where("subid", subid.subid).update("nooftickets", ticketamount.nooftickets);
          return res.status(200).send(deletesubride);
        } else if (transactionid && ticketid === transactionid.purchaseid) { // if ticket is transaction
          const deleteticket = await db("se_project.tickets").where("id", ticketid).del();
          return res.status(200).send("Deleted Successfully");
        }
      } else if (refundstatus === "Reject") {
        console.log(refundstatus);
        const deleteRequest = await db("se_project.refund_requests").where("id", requestid).del();
        return res.status(200).send("Deleted Successfully");
      }
    }
   } catch (e) {
      console.error(e.message);
      return res.status(500).send("Internal server error");
    }
  });//end of amr's code
  //simulate ride
  app.put("/api/v1/ride/simulate", async function (req, res) {
    try {
      const user = await getUser(req);
      const { origin, destination, tripDate } = req.body;
      if (!origin || !destination || !tripDate) {
        return res.status(400).send("Missing required fields");
      }
      const simulatedride = await db.select("*").from("se_project.rides")
        .where("origin", origin).andWhere("destination", destination).andWhere("tripdate", tripDate)
      simulatedride.status = "completed";
      return res.status(200).json(simulatedride);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Can't Simulate the ride");
    }
  });
  app.get("/api/v1/rides", async function (req, res) {
    try {
      const user = await getUser(req);
      const rides = await db.select("*").from("se_project.rides");
      return res.status(200).json(rides);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Can't get the rides");
    }
  });
  //Delete Station (admin):
  app.delete("/api/v1/station/:stationId", async function (req, res) {
    try {
      const user = await getUser(req);
      if (user.isAdmin) {
        const stationid = req.params.stationId;
        console.log("station id :" + stationid)
        const station = await db("se_project.stations").select("*").where("id", stationid);
        console.log("yess");
        if (!station) {
          return res.status(400).send("station not found");
        }
        if (station.stationtype == "normal" && station.stationposition == "start") {
          //normal & start         
          const route = await db("se_project.routes").where("fromStationid", stationid).first();
          console.log("weeeee" +route.fromStationid);
          
          let newrouteid = route.fromstationid;
          let nextroute = route.toStationid;
          await db("se_project.stations").where("id", newrouteid).del();
          await db("se_project.stations").where("id", nextroute).update({ stationposition: "start" });
          nextroute.stationposition = "start";
          // console.log("bekh")
          return res.status(200).send("Station deleted successfully");
        }
        else if (station.stationtype == "normal" && station.stationposition == "end") {
          //normal & end
          const nextStationend = await db("se_project.stations").where("toStationid", stationid);

          //fl end bnbd2 bl to w nnhi bl from, w not affect route brdo 
          let newroute = nextStationend.toStationid;
          let prevroute = nextStationend.fromStationid;
          await db("se_project.stations").where("id", newroute).del();
          await db("se_project.stations").where("id", prevroute).update({ stationposition: "end" });
          return res.status(200).send("Station deleted successfully");

        } else if (station.stationtype == "normal" && station.stationposition == ("middle")) {
          //normal & middle
          const route = await db("se_project.routes").where("fromStationid", stationid);
          // console.log(route);
          let oldroute = route[0].toStationid;
          let newroute = route[1].tostationid;
          const newrouteforward = {
            routename: "hi" + oldroute + "" + newroute,
            fromStationid: oldroute,
            toStationid: newroute,
          };
          let forward = await db("se_project.routes").insert(newrouteforward).returning("*");
          forward = forward[0];
          // console.log(forward[0])

          const newroutebackward = {
            routename: "hi" + newroute + "" + oldroute,
            fromStationid: newroute,
            toStationid: oldroute,
          };
          let backward = await db("se_project.routes").insert(newroutebackward).returning("*");
          backward = backward[0];

          const oldSRf = {
            stationid: oldroute,
            routeid: forward.id,
          };
          let oldSRfor = await db("se_project.stationroutes").insert(oldSRf).returning("*");

          const oldSRb = {
            stationid: oldroute,
            routeid: backward.id,
          };
          let oldSRback = await db("se_project.stationroutes").insert(oldSRb).returning("*");
          const newSRf = {
            stationid: newroute,
            routeid: forward.id,
          };
          let newSRfor = await db("se_project.stationroutes").insert(newSRf).returning("*");

          const newSRb = {
            stationid: newroute,
            routeid: backward.id,
          };
          let newSRback = await db("se_project.stationroutes").insert(newSRb).returning("*");

          const nextStationend = await db("se_project.stations").where("id", stationid).del();
          return res.status(200).send("Station deleted successfully");

        } else if (station.stationtype == "transfer") {
          // Transfer
          const mystation = await db("se_project.stations").where("id", stationid).first();
          // console.log(mystation);

          const routes = await db("se_project.routes").where("fromStationid", mystation.id);
          // console.log(routes);

          const toStationIds = []; // Array to store the tostationid values


          for (const route of routes) {
            // Get the tostationid value for the current route
            const toStationId = route.toStationid;
            // console.log(toStationId);

            if (toStationId !== null) {
              toStationIds.push(toStationId); // Add the tostationid to the array
            }
          }
          // console.log(toStationIds); // Log all the tostationid values

          const amount = toStationIds.length;
          // console.log(amount);
          for (const toStationId of toStationIds) {
            const prevroute = mystation.id; // Use the 'id' property of mystation
            // Create new object here using toStationId and the amount
            // Example:
            for (let i = 0; i < amount; i++) {
              const newObj = {
                routename: "hi" + prevroute + "" + toStationId,
                fromStationid: prevroute,
                toStationid: toStationId,
              };
              await db("se_project.routes").insert(newObj);
            }
          }
        }
        const deletingStation = await db("se_project.stations").where("id", stationid).del();
        return res.status(200).send("Station deleted successfully");
      } else {
        return res.status(400).send("Unauthorised access")
      }
    } catch (e) {
      console.log(e);
      return res.status(400).send("Station doesn't exist to delete or Mission Failed")
    }
  });

  //Delete Route (admin):
  app.delete("/api/v1/route/:routeId", async function (req, res) {
    try {
      const user = await getUser(req);
      if (user.isAdmin) {
        const routeId = req.params.routeId;
        // console.log(routeId);
        const routeToDelete = await db("se_project.routes").where("id", routeId).first();
        // console.log(routeToDelete.id);
        let from = routeToDelete.fromStationid;
        // console.log(from);
        let to = routeToDelete.toStationid;
        // console.log(to);
        if (!routeToDelete) {
          return res.status(404).send("Route not found");
        }
        const fromstationid = await db("se_project.stations").where("id", from).first();
        // console.log(fromstationid);
        const tostationid = await db("se_project.stations").where("id", to).first();
        // console.log(tostationid);

        if (fromstationid.stationposition == "start" && tostationid.stationposition == "middle") {
          await db("se_project.stations").where("id", fromstationid.id).update({ stationposition: "end" });
          await db("se_project.stations").where("id", tostationid.id).update({ stationposition: "start" });
          const deleted = await db("se_project.routes").where("id", routeId).first().del();
          return res.status(200).send("Route deleted successfully");
        }
        if (fromstationid.stationposition == "middle" && tostationid.stationpositiond == "start") {
          const deleted = await db("se_project.routes").where("id", routeId).first().del();
          return res.status(200).send("Route deleted successfully");
        }
        if (fromstationid.stationposition == "middle" && tostationid.stationposition == "end") {
          await db("se_project.stations").where("id", fromstationid.id).update({ stationposition: "end" });
          await db("se_project.stations").where("id", tostationid.id).update({ stationposition: null });
          const deleted = await db("se_project.routes").where("id", routeId).first().del();
          return res.status(200).send("Route deleted successfully");
        }
        if (fromstationid.stationposition == "end" && tostationid.stationposition == "middle") {
          const deleted = await db("se_project.routes").where("id", routeId).first().del();
          return res.status(200).send("Route deleted successfully");
        }

        //make sure lw el etnen ra70? lw bntklm fl awl, fa hyb2a el start null, w el ba3dha start
        //lw bntklm fl akher, fa hyb2a el end null, w el ablha end
        //doesnt make senseee tamamannnn !!!!
      } else {
        return res.status(400).send("You are not authorized to delete a route");
      }
    } catch (e) {
      console.error(e.message);
      return res.status(400).send("Could not delete the route");
    }
  });
  //this is martina's code
  //Starting farah's code 

  app.post("/api/v1/senior/request", async function (req, res) {
    try {
      const { nationalid } = req.body;
      console.log(nationalid);
      const user = await getUser(req);
      console.log(user.userid);
      const existingSeniorRequest = await db("se_project.senior_requests")
        .where("userid", user.userid)
        .first();

      if (existingSeniorRequest && existingSeniorRequest.status === "pending") {
        console.log("hi");
        return res.status(400).send("You already have a pending request");
      }

      if (user.isSenior) {
        return res.status(400).send("You are already a senior");
      }

      const seniorRequest = {
        nationalid: nationalid,
        status: "pending",
        userid: user.userid
      };

      await db("se_project.senior_requests").insert(seniorRequest);
      return res.status(200).send(seniorRequest.status);
    } catch (error) {
      console.error(error.message);
      return res.status(400).send("Could not add nationalId");
    }
  });

//update station(admin) done
app.put("/api/v1/station/:stationId", async function (req, res) {
  try {
    const user = await getUser(req);
    const useridd = user.userid
    if (user.isAdmin) {
      // const {stationname} = req.body;
      //const {stationid} = req.params;
      await db("se_project.stations")
        .where({ id: req.params.stationId })
        .update({ stationname: req.body.stationname, id: req.params.stationId });
      return res.status(200).send("stationId is updated successfully");
    } else {
      return res.status(400).send("you are not an admin");
    }
  } catch (e) {
    console.log(e.message);
    return res.status(400).send("can not update stationId");
  }
});

  
  //update route(admin) done
  app.put("/api/v1/route/:routeId", async function (req, res) {
    try {
      const user = await getUser(req);
      const useridd = user.userid;
      if (user.isAdmin) {
        //onst {routeid} = req.params;
        await db("se_project.routes")
          .where("id" ,req.params.routeId )
          .update( "routename", req.body.routename );
        return res.status(200).send("routeid is updated successfully");
      }
      else {
        return res.status(400).send("you are not an admin");
      }
    }
    catch (e) {
      console.log(e.message);
      return res.status(400).send("can not update routeid");
    }
  });




//check price
app.get('/api/v1/tickets/price/:originId&:destinationId', async (req, res) => {
  // const { originId, destinationId } = req.params;
  // const route = await db.select('*').from('se_project.routes').where('fromstationid', originId).andWhere('tostationid', destinationId);
  // console.log(route);
  // res.status(200).json(route);
  //});
  try {
  let { originId, destinationId } = req.params;
  let destinationDistance = {};
  let destinationReached = false;
  let visitedStationsSet = new Set();
  let queue = [originId];

  visitedStationsSet.add(Number(originId));
  destinationDistance[originId] = 1;
  //ghalat

  while (queue.length > 0) {
    let currentStation = queue.shift();
    console.log("currentStation: " + currentStation);
    if (currentStation == destinationId) {
      destinationReached = true;
      break;
    }
    const toStationidsObjects = await db.select('tostationid').from('se_project.routes').where('fromstationid', currentStation);
    console.log(toStationidsObjects);
    for (let i = 0; i < toStationidsObjects.length; i++) {
      let toStationId = toStationidsObjects[i].tostationid;
      console.log("toStationId: " + toStationId);
      if (visitedStationsSet.has(toStationId)) {
        console.log("already visited: " + toStationId);
        continue;
      }
      visitedStationsSet.add(toStationId);
      destinationDistance[toStationId] = destinationDistance[currentStation] + 1;
      queue.push(toStationId);
    }
  }


  const stationsCount = destinationDistance[destinationId];
  if (stationsCount <= 9) {
    price = 5;
  }
  else if (stationsCount >= 10 & stationsCount <= 16) {
    price = 7;
  }
  else {
    price = 10;
  }
  // res.status(200).send("price of ticket equal:", price);
  res.status(200).json({stationsCount: stationsCount, price: price});
}
catch(e){
  console.log(e.message);
  res.status(400).send("wrong entry");
}
});
//end of farah's code
//startof farida's code
 //ADMIN create a station
 
 app.post ("/api/v1/station", async function (req, res){
  const user= await getUser(req);
  if(user.isAdmin){
    try{
    const stationname = req.body;
    const userid=user.userid;
      await db("se_project.stations").where("id" , userid).insert({"stationname": stationname , "stationtype": "normal" , "stationstatus" :"new"});
      return res.status(200).send("Station Created!");
    }
    catch(e){
      console.log(e.message);
      return res.status(400).send("Could not create station");
    }
  }
  else{
    return res.status(400).send("You can't create station");

  }
});


//ADMIN creates a route 
app.post("/api/v1/route", async function(req,res){
  try{
  const user= await getUser(req);
  if(user.isAdmin){
    const {newStationId, connectedStationId, routeName} = req.body;
    if (!newStationId || !connectedStationId || !routeName) {
      return res.status(400).send("Missing required fields");
    }
    const connectedStationPosition= await db.select("stationposition").from("se_project.stations").where({"id": connectedStationId}).first();
    const routeid= await db.select("id").from("se_project.routes").where("routename", routeName);
    if(connectedStationPosition=='start'){
    
        const idroute= await db.select("id").from("se_project.routes").where({"routename": routeName})
        const newroute={
          routename: routeName,
          fromStationid: newStationId,
          toStationid: connectedStationId,
        };
        const newstationroute={
          stationid: newStationId,
          routeid: idroute,
        };
        const route= await db("se_project.routes").insert(newroute).returning("*");
        await db("se_project.stations").where("id",newStationId).update({stationposition: "start"});
        const newroutestation= await db("stationRoutes").insert(newstationroute).returning("*");
      await db("se_project.stations").where("id",connectedStationId).update({stationposition: "middle"});
        return res.status(200).json(route); 
        //return res.status(200).json(newroutestation);

    }
    else if(connectedStationPosition=='end'){
  
        const newroute={
          routename: routeName,
          fromStationid: newStationId,
          toStationid: connectedStationId,
        };
        const newstationroute={
          stationid: newStationId,
          routeid: routeid,
        };
        await db("se_project.stations").where("id",newStationId).update({stationposition: "end"});
        await db("se_project.stations").where("id",connectedStationId).update({stationposition: "middle"});
        const route= await db("se_project.routes").insert(newroute).returning("*");
        const routeid= await db.select("id").from("se_project.routes").where({"routename": routeName});
        res.status(200).json(route); 
        const newroutestation= await db("stationRoutes").insert(newstationroute).returning("*");
        //no "return"
         res.status(200).json(newroutestation); 

      //ROUTE ID MENEN
      
        
    // newStationPosition= 'end';
      // connectedStationPosition='middle';
      // route.fromStationid= connectedStationId;
      // route.toStationid= newStationId;
    
    }
  }
//UPDATE ROUTES AS WELL
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not create route");
    }
  
});
///pay ticket for subscription:
app.post("/api/v1/payment/ticket", async function (req, res) {
  try{
      const user = await getUser(req);
      const useridsubscription = await db.select("userid").from("se_project.subsription");
      if(useridsubscription != user.id){
      const {purchasediid, creditcardnumber, holdername, payedamount, origin, destination, tripdate} = req.body;
      const transaction = {amount: payedamount, userid: user.id, purchasediid: purchasediid};
      const [transactionid] = await db("se_project.transactions").insert(transaction).returning("id");
      //insert ticket into upcoming ride 
      //const ticketinsert = await db("se_project.rides").insert(tripdate).returning("id","tripdate");
      return res.status(200).json({transactionid});
      }else{
        return res.status(200).send("user has a subscription");
      }
  }catch(e){
      console.log(e.message);
      return res.status(400).send("Could not Purchase Ticket");
    }
  });
  
  //this is farida's code
//start of eyad's code
//table viewing routes
app.get("/api/v1/routes", async function(req, res){
  const getroutes = await db("se_project.routes").select("*");
  return res.status(200).json(getroutes);
});

//view pending refund requests
app.get("/api/v1/refunds", async function(req,res){
  const getrefund = await db("se_project.refunds").select("*");
  return res.status(200).json(getrefund);
});

//view pending senior requests
app.get("/api/v1/seniorrequests", async function(req,res){
  const getsnior = await db("se_project.senior_requests").select("*");
  return res.status(200).json(getsnior);
});

//view all zones
app.get("/api/v1/zones", async function(req,res) {
const allzones = await db("se_project.zones").select("*")
return res.status(200).json(allzones);
});

app.put("/api/v1/zones/:zoneId", async function(req,res){
  try{
    const user = await getUser(req);
    if(user.isAdmin){
   
    const updatedprice = await db("se_project.zones").where("id", req.params.zoneId).update("price", req.body.price);
    console.log(updatedprice.price);
    return res.status(200).send(updatedprice.price);
    }else{
      return res.status(400).send("You are not authorized to update zone price");
    }
  } catch(e){
    console.log(e.message);
    return res.status(400).send("failed to update");
} 

});
//this is eyads code(mn wp) 
app.post("/api/v1/refund/:ticketId", async (req, res) => {
  const { ticketId } = req.params;
  console.log(ticketId)
  const user = await getUser(req);
  const userid = user.userid;

  const ticket = await db("se_project.tickets")
    .select('*')
    .where({ id: ticketId })
    .first();
  console.log(ticket)
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  // Check if ticket is future-dated
  const currentDate = new Date();
  const ticketDate = new Date(ticket.tripdate);
 
  console.log(currentDate)
  console.log(ticketDate)
  if (ticketDate.getTime() > currentDate.getTime()) {
    console.log("ana fl if")
    // Insert refund request
    const transaction = await db("se_project.transactions").select('*').where("purchasedid", ticketId ).first();
    console.log(transaction)
    if (!transaction) {
      return res.status(500).json({ error: "Transaction not found" });
    }
    const refundamount = transaction.amount;
    console.log(refundamount)
    const refundRequest = await db('se_project.refund_requests').insert({
      status: 'pending',
      userid: userid,
      refundamount: refundamount,
      ticketid: ticketId,
    });

    // Delete ticket
    return res.json( "Ticket refunded successfully");
  } else {
  
    return res.status(500).json( "Ticket already used" );
  }
});
//this is farida's code

};